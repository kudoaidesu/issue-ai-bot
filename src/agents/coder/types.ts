import type { IssueInfo } from '../../github/issues.js'
import type { ProjectConfig } from '../../config.js'

export interface CoderAgentInput {
  issue: IssueInfo
  project: ProjectConfig
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
