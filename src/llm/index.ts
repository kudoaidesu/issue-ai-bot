export { runClaudeCli, type ClaudeCliOptions } from './claude-cli.js'
export { runClaudeSdk, type ClaudeSdkOptions } from './claude-sdk.js'

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
