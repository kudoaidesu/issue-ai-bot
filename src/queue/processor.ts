import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('queue')

export type Priority = 'high' | 'medium' | 'low'
export type QueueStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface QueueItem {
  id: string
  issueNumber: number
  repository: string
  priority: Priority
  status: QueueStatus
  createdAt: string
  scheduledAt?: string
  completedAt?: string
  error?: string
}

const queueFilePath = join(config.queue.dataDir, 'queue.json')

function ensureDataDir(): void {
  if (!existsSync(config.queue.dataDir)) {
    mkdirSync(config.queue.dataDir, { recursive: true })
  }
}

function loadQueue(): QueueItem[] {
  ensureDataDir()
  if (!existsSync(queueFilePath)) {
    return []
  }
  const raw = readFileSync(queueFilePath, 'utf-8')
  return JSON.parse(raw) as QueueItem[]
}

function saveQueue(items: QueueItem[]): void {
  ensureDataDir()
  writeFileSync(queueFilePath, JSON.stringify(items, null, 2), 'utf-8')
}

export function enqueue(
  issueNumber: number,
  repository: string,
  priority: Priority = 'medium',
): QueueItem {
  const items = loadQueue()

  const item: QueueItem = {
    id: randomUUID(),
    issueNumber,
    repository,
    priority,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }

  items.push(item)
  saveQueue(items)

  log.info(`Enqueued Issue #${issueNumber} (${priority}) → ${item.id}`)
  return item
}

export function dequeue(): QueueItem | null {
  const items = loadQueue()

  const priorityOrder: Priority[] = ['high', 'medium', 'low']
  let next: QueueItem | undefined

  for (const p of priorityOrder) {
    next = items.find((i) => i.status === 'pending' && i.priority === p)
    if (next) break
  }

  if (!next) return null

  next.status = 'processing'
  saveQueue(items)

  log.info(`Dequeued Issue #${next.issueNumber} → ${next.id}`)
  return next
}

export function getAll(): QueueItem[] {
  return loadQueue()
}

export function getPending(): QueueItem[] {
  return loadQueue().filter((i) => i.status === 'pending')
}

export function updateStatus(
  id: string,
  status: QueueStatus,
  error?: string,
): void {
  const items = loadQueue()
  const item = items.find((i) => i.id === id)
  if (!item) {
    log.warn(`Queue item not found: ${id}`)
    return
  }

  item.status = status
  if (status === 'completed' || status === 'failed') {
    item.completedAt = new Date().toISOString()
  }
  if (error) {
    item.error = error
  }

  saveQueue(items)
  log.info(`Queue item ${id} → ${status}`)
}

export function removeCompleted(): number {
  const items = loadQueue()
  const before = items.length
  const remaining = items.filter(
    (i) => i.status !== 'completed' && i.status !== 'failed',
  )
  saveQueue(remaining)
  const removed = before - remaining.length
  if (removed > 0) {
    log.info(`Removed ${removed} completed/failed items`)
  }
  return removed
}

export function getStats(): {
  pending: number
  processing: number
  completed: number
  failed: number
  total: number
} {
  const items = loadQueue()
  return {
    pending: items.filter((i) => i.status === 'pending').length,
    processing: items.filter((i) => i.status === 'processing').length,
    completed: items.filter((i) => i.status === 'completed').length,
    failed: items.filter((i) => i.status === 'failed').length,
    total: items.length,
  }
}
