import cron, { type ScheduledTask } from 'node-cron'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'
import { dequeue, getStats, updateStatus, markForRetry } from './processor.js'
import { acquireLock, releaseLock } from './rate-limiter.js'
import { notifyUsageAlert, notifyDailyUsageStatus } from '../bot/notifier.js'
import { scrapeUsage, evaluateAlerts } from '../utils/usage-monitor.js'
import type { UsageReport, UsageAlerts } from '../utils/usage-monitor.js'

const log = createLogger('scheduler')

const tasks = new Map<string, ScheduledTask>()

export type QueueProcessHandler = (issueNumber: number, repository: string, queueItemId: string) => Promise<void>

let processHandler: QueueProcessHandler | null = null

export function setProcessHandler(handler: QueueProcessHandler): void {
  processHandler = handler
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function processQueue(): Promise<void> {
  if (!acquireLock()) {
    log.warn('Queue processing already in progress. Skipping.')
    return
  }

  try {
    const stats = getStats()
    log.info(`Queue processing started — ${stats.pending} pending items`)

    if (stats.pending === 0) {
      log.info('No pending items. Skipping.')
      return
    }

    const maxBatch = config.queue.maxBatchSize
    const cooldownMs = config.queue.cooldownMs
    let processed = 0

    let item = dequeue()
    while (item && processed < maxBatch) {
      log.info(`Processing Issue #${item.issueNumber} (${item.id}) [${processed + 1}/${maxBatch}]`)

      if (processHandler) {
        try {
          await processHandler(item.issueNumber, item.repository, item.id)
          updateStatus(item.id, 'completed')
          log.info(`Issue #${item.issueNumber} completed`)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const willRetry = markForRetry(item.id, message)
          if (willRetry) {
            log.warn(`Issue #${item.issueNumber} failed, scheduled for retry: ${message}`)
          } else {
            log.error(`Issue #${item.issueNumber} failed permanently: ${message}`)
          }
        }
      } else {
        log.warn('No process handler registered. Skipping item.')
        updateStatus(item.id, 'pending')
        break
      }

      processed++

      // Cooldown: 次のジョブ前に待機
      item = dequeue()
      if (item && processed < maxBatch) {
        log.info(`Cooldown: waiting ${cooldownMs / 1000}s before next job...`)
        await sleep(cooldownMs)
      }
    }

    const after = getStats()
    log.info(
      `Queue processing done — processed: ${processed}, completed: ${after.completed}, failed: ${after.failed}`,
    )
  } finally {
    releaseLock()
  }
}

// アラート状態をファイルに永続化（再起動後もリセットされず重複送信を防ぐ）
type AlertStateFlags = {
  sessionRateLimited: boolean
  wakeTimeConflict: boolean
  weeklyPaceExceeded: boolean
  sonnetPaceExceeded: boolean
  codexPaceExceeded: boolean
}

const ALERT_STATE_PATH = resolve(config.queue.dataDir, 'alert-state.json')

function loadAlertState(): AlertStateFlags {
  try {
    return JSON.parse(readFileSync(ALERT_STATE_PATH, 'utf-8')) as AlertStateFlags
  } catch {
    return { sessionRateLimited: false, wakeTimeConflict: false, weeklyPaceExceeded: false, sonnetPaceExceeded: false, codexPaceExceeded: false }
  }
}

function saveAlertState(state: AlertStateFlags): void {
  try {
    writeFileSync(ALERT_STATE_PATH, JSON.stringify(state))
  } catch (err) {
    log.warn(`Failed to save alert state: ${(err as Error).message}`)
  }
}

let prevAlertStates: AlertStateFlags = loadAlertState()

async function scrapeAndAlert(): Promise<void> {
  log.info('Usage scrape triggered')
  try {
    const report = await scrapeUsage()
    const alerts = evaluateAlerts(report)

    const claudeSession = report.claude?.claude?.session?.usagePercent ?? '?'
    const codexPct = report.codex?.codex?.usagePercent ?? '?'

    // データが取得できたコンポーネントのみ状態を更新
    // スクレイプ失敗時は前回の状態を維持し、誤リセットによる重複送信を防ぐ
    const nextStates = { ...prevAlertStates }
    if (report.claude?.claude) {
      nextStates.sessionRateLimited = alerts.sessionRateLimited
      nextStates.wakeTimeConflict = alerts.wakeTimeConflict
      nextStates.weeklyPaceExceeded = alerts.weeklyPaceExceeded
      nextStates.sonnetPaceExceeded = alerts.sonnetPaceExceeded
    }
    if (report.codex?.codex?.usagePercent !== undefined) {
      nextStates.codexPaceExceeded = alerts.codexPaceExceeded
    }

    // false → true に新たに遷移した種別のみ抽出
    const newlyTriggered = {
      sessionRateLimited: !prevAlertStates.sessionRateLimited && nextStates.sessionRateLimited,
      wakeTimeConflict: !prevAlertStates.wakeTimeConflict && nextStates.wakeTimeConflict,
      weeklyPaceExceeded: !prevAlertStates.weeklyPaceExceeded && nextStates.weeklyPaceExceeded,
      sonnetPaceExceeded: !prevAlertStates.sonnetPaceExceeded && nextStates.sonnetPaceExceeded,
      codexPaceExceeded: !prevAlertStates.codexPaceExceeded && nextStates.codexPaceExceeded,
    }
    const hasNewAlerts = Object.values(newlyTriggered).some(Boolean)

    prevAlertStates = nextStates
    saveAlertState(nextStates)

    if (alerts.hasAlerts) {
      log.warn(`Usage alert active: Claude session=${claudeSession}%, Codex=${codexPct}%`)
    } else {
      log.info(`Usage within limits: Claude session=${claudeSession}%, Codex=${codexPct}%`)
    }

    if (hasNewAlerts) {
      log.info(`New alert(s) triggered: ${Object.entries(newlyTriggered).filter(([, v]) => v).map(([k]) => k).join(', ')}`)
      const alertsToSend: UsageAlerts = {
        ...alerts,
        sessionRateLimited: newlyTriggered.sessionRateLimited,
        wakeTimeConflict: newlyTriggered.wakeTimeConflict,
        weeklyPaceExceeded: newlyTriggered.weeklyPaceExceeded,
        sonnetPaceExceeded: newlyTriggered.sonnetPaceExceeded,
        codexPaceExceeded: newlyTriggered.codexPaceExceeded,
        hasAlerts: hasNewAlerts,
      }
      for (const project of config.projects) {
        const alertChannelId = project.alertChannelId
        if (alertChannelId) {
          await notifyUsageAlert(alertsToSend, report, alertChannelId)
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`Usage scrape failed: ${message}`)
  }
}

async function reportDailyUsageStatus(): Promise<void> {
  log.info('Daily usage status report triggered')
  try {
    const report = await scrapeUsage()
    const queueStats = getStats()
    for (const project of config.projects) {
      const alertChannelId = project.alertChannelId
      if (alertChannelId) {
        await notifyDailyUsageStatus(report, alertChannelId, queueStats)
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`Daily usage status report failed: ${message}`)
  }
}

export function startScheduler(): void {
  const processTask = cron.schedule(
    config.cron.schedule,
    () => {
      void processQueue()
    },
    { timezone: 'Asia/Tokyo' },
  )
  tasks.set('queue-process', processTask)
  log.info(`Queue processing scheduled: ${config.cron.schedule}`)

  const usageScrapeTask = cron.schedule(
    config.usageMonitor.scrapeSchedule,
    () => {
      void scrapeAndAlert()
    },
    { timezone: 'Asia/Tokyo' },
  )
  tasks.set('usage-scrape', usageScrapeTask)
  log.info(`Usage scrape scheduled: ${config.usageMonitor.scrapeSchedule}`)

  const dailyUsageStatusTask = cron.schedule(
    config.cron.dailyUsageStatusSchedule,
    () => {
      void reportDailyUsageStatus()
    },
    { timezone: 'Asia/Tokyo' },
  )
  tasks.set('daily-usage-status', dailyUsageStatusTask)
  log.info(`Daily usage status scheduled: ${config.cron.dailyUsageStatusSchedule}`)
}

export function stopScheduler(): void {
  for (const [name, task] of tasks) {
    task.stop()
    log.info(`Stopped cron: ${name}`)
  }
}

export function getScheduledTasks(): { name: string; schedule: string }[] {
  return [
    { name: 'queue-process', schedule: config.cron.schedule },
    { name: 'usage-scrape', schedule: config.usageMonitor.scrapeSchedule },
    { name: 'daily-usage-status', schedule: config.cron.dailyUsageStatusSchedule },
  ]
}

export async function runNow(): Promise<void> {
  log.info('Manual queue processing triggered')
  await processQueue()
}

export async function runUsageMonitorNow(): Promise<UsageReport> {
  log.info('Manual usage monitor triggered')
  return scrapeUsage()
}

// --- 即時処理 ---

export type ImmediateResult =
  | { status: 'started' }
  | { status: 'locked'; reason: string }
  | { status: 'no_handler' }

export async function processImmediate(
  issueNumber: number,
  repository: string,
): Promise<ImmediateResult> {
  log.info(`Immediate processing requested for Issue #${issueNumber} (${repository})`)

  if (!processHandler) {
    log.warn('No process handler registered for immediate processing')
    return { status: 'no_handler' }
  }

  if (!acquireLock()) {
    log.warn('Lock held. Cannot process immediately — will fall back to queue.')
    return { status: 'locked', reason: '別のタスクが処理中です' }
  }

  // Fire-and-forget: ロック取得後に即座に return し、処理はバックグラウンドで実行
  const queueItemId = `immediate-${issueNumber}-${Date.now()}`

  void (async () => {
    try {
      await processHandler!(issueNumber, repository, queueItemId)
      log.info(`Immediate processing completed for Issue #${issueNumber}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`Immediate processing failed for Issue #${issueNumber}: ${message}`)
    } finally {
      releaseLock()
    }
  })()

  return { status: 'started' }
}
