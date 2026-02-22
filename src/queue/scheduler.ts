import cron, { type ScheduledTask } from 'node-cron'
import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'
import { dequeue, getStats, updateStatus } from './processor.js'

const log = createLogger('scheduler')

const tasks = new Map<string, ScheduledTask>()

export type QueueProcessHandler = (issueNumber: number, repository: string) => Promise<void>

let processHandler: QueueProcessHandler | null = null

export function setProcessHandler(handler: QueueProcessHandler): void {
  processHandler = handler
}

async function processQueue(): Promise<void> {
  const stats = getStats()
  log.info(`Queue processing started — ${stats.pending} pending items`)

  if (stats.pending === 0) {
    log.info('No pending items. Skipping.')
    return
  }

  let item = dequeue()
  while (item) {
    log.info(`Processing Issue #${item.issueNumber} (${item.id})`)

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

    item = dequeue()
  }

  const after = getStats()
  log.info(
    `Queue processing done — completed: ${after.completed}, failed: ${after.failed}`,
  )
}

function reportStatus(): void {
  const stats = getStats()
  log.info(
    `[Report] pending=${stats.pending} processing=${stats.processing} completed=${stats.completed} failed=${stats.failed} total=${stats.total}`,
  )
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
    reportStatus,
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
