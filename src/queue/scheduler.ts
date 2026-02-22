import cron, { type ScheduledTask } from 'node-cron'
import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'
import { dequeue, getStats, updateStatus } from './processor.js'
import { acquireLock, releaseLock, isDailyBudgetExceeded } from './rate-limiter.js'
import { getDailyCost, getCostReport } from '../utils/cost-tracker.js'
import { notifyCostReport, notifyCostAlert } from '../bot/notifier.js'

const log = createLogger('scheduler')

const tasks = new Map<string, ScheduledTask>()

export type QueueProcessHandler = (issueNumber: number, repository: string) => Promise<void>

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

    // 予算ガード: バッチ開始前
    if (isDailyBudgetExceeded()) {
      log.warn('Daily budget exceeded. Skipping queue processing.')
      for (const project of config.projects) {
        await notifyCostAlert(getDailyCost(), config.queue.dailyBudgetUsd, project.channelId)
      }
      return
    }

    const maxBatch = config.queue.maxBatchSize
    const cooldownMs = config.queue.cooldownMs
    let processed = 0

    let item = dequeue()
    while (item && processed < maxBatch) {
      // 予算ガード: 各ジョブ前
      if (isDailyBudgetExceeded()) {
        log.warn('Daily budget exceeded mid-batch. Stopping.')
        updateStatus(item.id, 'pending')
        for (const project of config.projects) {
          await notifyCostAlert(getDailyCost(), config.queue.dailyBudgetUsd, project.channelId)
        }
        break
      }

      log.info(`Processing Issue #${item.issueNumber} (${item.id}) [${processed + 1}/${maxBatch}]`)

      if (processHandler) {
        try {
          await processHandler(item.issueNumber, item.repository)
          updateStatus(item.id, 'completed')
          log.info(`Issue #${item.issueNumber} completed`)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          updateStatus(item.id, 'failed', message)
          log.error(`Issue #${item.issueNumber} failed: ${message}`)
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

async function reportStatus(): Promise<void> {
  const stats = getStats()
  log.info(
    `[Report] pending=${stats.pending} processing=${stats.processing} completed=${stats.completed} failed=${stats.failed} total=${stats.total}`,
  )

  // コスト + キューレポートを Discord に送信
  const costReport = getCostReport()
  for (const project of config.projects) {
    await notifyCostReport(costReport, stats, project.channelId)
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

  const reportTask = cron.schedule(
    config.cron.reportSchedule,
    () => {
      void reportStatus()
    },
    { timezone: 'Asia/Tokyo' },
  )
  tasks.set('status-report', reportTask)
  log.info(`Status report scheduled: ${config.cron.reportSchedule}`)
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
    { name: 'status-report', schedule: config.cron.reportSchedule },
  ]
}

export async function runNow(): Promise<void> {
  log.info('Manual queue processing triggered')
  await processQueue()
}
