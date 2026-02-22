import type { IssueInfo } from '../../github/issues.js'
import type { ProjectConfig } from '../../config.js'

export type ProgressStage =
  | 'setup'
  | 'coding'
  | 'verifying'
  | 'pushing'
  | 'retrying'
  | 'done'
  | 'failed'

export interface ProgressData {
  stage: ProgressStage
  message: string
  attempt?: number
  maxAttempts?: number
  prUrl?: string
  costUsd?: number
  durationMs?: number
  error?: string
}

export type ProgressReporter = (data: ProgressData) => void

export interface TaichoInput {
  issue: IssueInfo
  project: ProjectConfig
  onProgress?: ProgressReporter
  /** Strategy 名を指定して実行方法を切り替える。省略時は config のデフォルトを使用 */
  strategy?: string
}

export interface TaichoResult {
  success: boolean
  prUrl?: string
  branchName?: string
  costUsd?: number
  durationMs?: number
  error?: string
  retryCount: number
}

// --- Strategy インターフェース ---

/** Strategy に渡される実行コンテキスト */
export interface CodingContext {
  issue: IssueInfo
  project: ProjectConfig
  baseBranch: string
  branchName: string
  attempt: number
  maxAttempts: number
}

/** Strategy の実行結果 */
export interface CodingResult {
  costUsd?: number
}

/**
 * CodingStrategy: Issue からコード変更を生成する「やり方」を定義する。
 *
 * 責務境界: 現在のブランチ上にコミットを生成するところまで。
 * Git操作・Push・PR作成・リトライ・監査はオーケストレータ（taicho/index.ts）が担当する。
 */
export interface CodingStrategy {
  readonly name: string
  execute(ctx: CodingContext): Promise<CodingResult>
}
