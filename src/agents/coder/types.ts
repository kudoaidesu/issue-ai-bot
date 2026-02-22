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

export interface CoderAgentInput {
  issue: IssueInfo
  project: ProjectConfig
  onProgress?: ProgressReporter
}

export interface CoderAgentResult {
  success: boolean
  prUrl?: string
  branchName?: string
  costUsd?: number
  durationMs?: number
  error?: string
  retryCount: number
}
