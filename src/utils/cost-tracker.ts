import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { config } from '../config.js'
import { createLogger } from './logger.js'

const log = createLogger('cost-tracker')

export interface CostEntry {
  timestamp: string
  issueNumber: number
  repository: string
  costUsd: number
  durationMs: number
  success: boolean
  prUrl?: string
  retryCount: number
}

export interface CostReport {
  today: number
  thisWeek: number
  thisMonth: number
  byRepository: Array<{ repository: string; costUsd: number }>
  recentEntries: CostEntry[]
  dailyBudgetUsedPercent: number
}

const costFilePath = join(config.queue.dataDir, 'costs.jsonl')

function ensureDir(): void {
  const dir = dirname(costFilePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function readAllEntries(): CostEntry[] {
  if (!existsSync(costFilePath)) return []

  const lines = readFileSync(costFilePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())

  return lines.map((line) => JSON.parse(line) as CostEntry)
}

/** JST (UTC+9) での日付開始時刻を取得 */
function getJstDayStart(date: Date = new Date()): Date {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  const dayStart = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()))
  return new Date(dayStart.getTime() - 9 * 60 * 60 * 1000)
}

/** JST での週の開始（月曜日）を取得 */
function getJstWeekStart(date: Date = new Date()): Date {
  const dayStart = getJstDayStart(date)
  const jst = new Date(dayStart.getTime() + 9 * 60 * 60 * 1000)
  const dayOfWeek = jst.getUTCDay()
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  return new Date(dayStart.getTime() - daysToMonday * 24 * 60 * 60 * 1000)
}

/** JST での月の開始を取得 */
function getJstMonthStart(date: Date = new Date()): Date {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  const monthStart = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1))
  return new Date(monthStart.getTime() - 9 * 60 * 60 * 1000)
}

function sumCostSince(entries: CostEntry[], since: Date): number {
  const sinceIso = since.toISOString()
  return entries
    .filter((e) => e.timestamp >= sinceIso)
    .reduce((sum, e) => sum + e.costUsd, 0)
}

export function recordCost(entry: Omit<CostEntry, 'timestamp'>): void {
  ensureDir()
  const full: CostEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  }
  appendFileSync(costFilePath, JSON.stringify(full) + '\n', 'utf-8')
  log.info(`Recorded cost: Issue #${entry.issueNumber} (${entry.repository}) $${entry.costUsd.toFixed(2)}`)
}

export function getDailyCost(date?: Date): number {
  const entries = readAllEntries()
  return sumCostSince(entries, getJstDayStart(date))
}

export function getWeeklyCost(date?: Date): number {
  const entries = readAllEntries()
  return sumCostSince(entries, getJstWeekStart(date))
}

export function getMonthlyCost(date?: Date): number {
  const entries = readAllEntries()
  return sumCostSince(entries, getJstMonthStart(date))
}

export function getCostReport(): CostReport {
  const entries = readAllEntries()
  const now = new Date()

  const today = sumCostSince(entries, getJstDayStart(now))
  const thisWeek = sumCostSince(entries, getJstWeekStart(now))
  const thisMonth = sumCostSince(entries, getJstMonthStart(now))

  // プロジェクト別（今月分）
  const monthStart = getJstMonthStart(now).toISOString()
  const monthEntries = entries.filter((e) => e.timestamp >= monthStart)
  const repoMap = new Map<string, number>()
  for (const e of monthEntries) {
    repoMap.set(e.repository, (repoMap.get(e.repository) ?? 0) + e.costUsd)
  }
  const byRepository = Array.from(repoMap.entries())
    .map(([repository, costUsd]) => ({ repository, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd)

  const dailyBudget = config.queue.dailyBudgetUsd
  const dailyBudgetUsedPercent = dailyBudget > 0 ? (today / dailyBudget) * 100 : 0

  return {
    today,
    thisWeek,
    thisMonth,
    byRepository,
    recentEntries: entries.slice(-10).reverse(),
    dailyBudgetUsedPercent,
  }
}
