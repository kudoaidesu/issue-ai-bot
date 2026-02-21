import { runClaudeCli, type ClaudeCliOptions } from './claude-cli.js'
import { runClaudeSdk, type ClaudeSdkOptions } from './claude-sdk.js'

export type LlmMode = 'cli' | 'sdk'

export interface LlmOptions {
  prompt: string
  systemPrompt?: string
  model?: string
  maxBudgetUsd?: number
  maxTurns?: number
  cwd?: string
  allowedTools?: string[]
}

export interface LlmResult {
  content: string
  costUsd?: number
}

export async function runLlm(
  mode: LlmMode,
  options: LlmOptions,
): Promise<LlmResult> {
  if (mode === 'sdk') {
    return runClaudeSdk(options as ClaudeSdkOptions)
  }
  return runClaudeCli(options as ClaudeCliOptions)
}
