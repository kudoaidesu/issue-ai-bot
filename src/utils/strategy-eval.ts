import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { config } from '../config.js'
import { createLogger } from './logger.js'
import type { IssueDifficulty } from '../agents/taicho/types.js'

const log = createLogger('strategy-eval')

/**
 * Strategy 評価レコード
 * Issue #26 で定義された評価データ構造
 */
export interface StrategyEvalRecord {
  timestamp: string
  issueNumber: number
  repository: string

  // 入力
  difficulty: IssueDifficulty
  strategyName: string

  // 実行結果
  success: boolean
  durationMs: number
  retryCount: number

  // コード変更
  commitCount: number
  linesAdded: number
  linesRemoved: number
  filesChanged: number

  // Strategy 詳細
  llmCallCount?: number
  llmModels?: string[]

  // PR 状態
  prUrl?: string
  prMerged?: boolean
  prMergedAt?: string

  // 手直し
  fixupCommitCount?: number  // マージ後のリビジョン
  reviewCommentCount?: number  // PR コメント数

  // 品質指標
  buildPassed?: boolean
  testsPassed?: boolean

  // メモ
  notes?: string
}

const evalFilePath = join(config.queue.dataDir, 'strategy-eval.jsonl')

function ensureDir(): void {
  const dir = dirname(evalFilePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * Strategy 評価レコードを記録
 */
export function recordStrategyEval(entry: Omit<StrategyEvalRecord, 'timestamp'>): void {
  ensureDir()
  const full: StrategyEvalRecord = {
    timestamp: new Date().toISOString(),
    ...entry,
  }
  appendFileSync(evalFilePath, JSON.stringify(full) + '\n', 'utf-8')
  log.info(
    `Recorded strategy eval: Issue #${entry.issueNumber} (${entry.repository}) ` +
      `${entry.strategyName} difficulty=${entry.difficulty} ` +
      `${entry.success ? 'success' : 'failed'} (${entry.durationMs}ms, retry=${entry.retryCount})`,
  )
}

/**
 * 全評価レコードを取得
 */
export function getAllStrategyEvals(): StrategyEvalRecord[] {
  if (!existsSync(evalFilePath)) return []

  const lines = readFileSync(evalFilePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())

  return lines.map((line) => JSON.parse(line) as StrategyEvalRecord)
}

/**
 * Strategy 別の集計レポート
 */
export interface StrategyReport {
  strategyName: string
  count: number
  successCount: number
  successRate: number  // 0-100
  avgDurationMs: number
  avgRetryCount: number
  totalLinesAdded: number
  totalLinesRemoved: number
}

export function getStrategyReport(): StrategyReport[] {
  const records = getAllStrategyEvals()
  const grouped = new Map<string, StrategyEvalRecord[]>()

  // Strategy ごとにグループ化
  for (const record of records) {
    const key = record.strategyName
    if (!grouped.has(key)) {
      grouped.set(key, [])
    }
    grouped.get(key)!.push(record)
  }

  // 集計
  const reports: StrategyReport[] = []
  for (const [strategyName, records] of grouped.entries()) {
    const successCount = records.filter((r) => r.success).length
    const avgDurationMs = records.reduce((sum, r) => sum + r.durationMs, 0) / records.length
    const avgRetryCount = records.reduce((sum, r) => sum + r.retryCount, 0) / records.length
    const totalLinesAdded = records.reduce((sum, r) => sum + r.linesAdded, 0)
    const totalLinesRemoved = records.reduce((sum, r) => sum + r.linesRemoved, 0)

    reports.push({
      strategyName,
      count: records.length,
      successCount,
      successRate: (successCount / records.length) * 100,
      avgDurationMs,
      avgRetryCount,
      totalLinesAdded,
      totalLinesRemoved,
    })
  }

  // Strategy 名でソート
  reports.sort((a, b) => a.strategyName.localeCompare(b.strategyName))

  return reports
}

/**
 * 難易度別の Strategy 成功率
 */
export interface DifficultyStrategyReport {
  difficulty: IssueDifficulty
  strategyName: string
  count: number
  successCount: number
  successRate: number
  avgDurationMs: number
}

export function getDifficultyStrategyReport(): DifficultyStrategyReport[] {
  const records = getAllStrategyEvals()
  const grouped = new Map<string, StrategyEvalRecord[]>()

  // 難易度 + Strategy で二重グループ化
  for (const record of records) {
    const key = `${record.difficulty}:${record.strategyName}`
    if (!grouped.has(key)) {
      grouped.set(key, [])
    }
    grouped.get(key)!.push(record)
  }

  const reports: DifficultyStrategyReport[] = []
  for (const [key, records] of grouped.entries()) {
    const [difficulty, strategyName] = key.split(':')
    const successCount = records.filter((r) => r.success).length
    const avgDurationMs = records.reduce((sum, r) => sum + r.durationMs, 0) / records.length

    reports.push({
      difficulty: difficulty as IssueDifficulty,
      strategyName,
      count: records.length,
      successCount,
      successRate: (successCount / records.length) * 100,
      avgDurationMs,
    })
  }

  // 難易度でソート（S < M < L < XL）、その後 Strategy 名でソート
  const difficultyOrder: Record<IssueDifficulty, number> = { S: 0, M: 1, L: 2, XL: 3 }
  reports.sort((a, b) => {
    if (difficultyOrder[a.difficulty] !== difficultyOrder[b.difficulty]) {
      return difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty]
    }
    return a.strategyName.localeCompare(b.strategyName)
  })

  return reports
}
