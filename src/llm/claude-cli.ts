import { execFile } from 'node:child_process'
import { createLogger } from '../utils/logger.js'

const log = createLogger('claude-cli')

export interface ClaudeCliOptions {
  prompt: string
  systemPrompt?: string
  model?: string
  maxBudgetUsd?: number
  cwd?: string
  allowedTools?: string[]
  timeoutMs?: number
  skipPermissions?: boolean
}

export interface ClaudeCliResult {
  content: string
  costUsd?: number
}

interface ClaudeJsonOutput {
  result: string
  cost_usd?: number
  duration_ms?: number
  duration_api_ms?: number
  is_error?: boolean
  num_turns?: number
  session_id?: string
}

export function runClaudeCli(options: ClaudeCliOptions): Promise<ClaudeCliResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', options.prompt,
      '--output-format', 'json',
    ]

    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt)
    }
    if (options.model) {
      args.push('--model', options.model)
    }
    if (options.maxBudgetUsd) {
      args.push('--max-budget-usd', String(options.maxBudgetUsd))
    }
    if (options.allowedTools) {
      args.push('--allowedTools', ...options.allowedTools)
    }
    if (options.skipPermissions) {
      args.push('--dangerously-skip-permissions')
    }

    log.info(`Executing: claude -p "${options.prompt.slice(0, 60)}..."`)

    execFile(
      'claude',
      args,
      {
        cwd: options.cwd ?? process.cwd(),
        maxBuffer: 10 * 1024 * 1024, // 10MB
        timeout: options.timeoutMs ?? 5 * 60 * 1000,
      },
      (error, stdout, stderr) => {
        if (stderr) {
          log.warn(`stderr: ${stderr.slice(0, 200)}`)
        }

        if (error) {
          log.error('Claude CLI failed', error)
          reject(new Error(`Claude CLI failed: ${error.message}`))
          return
        }

        try {
          const parsed = JSON.parse(stdout) as ClaudeJsonOutput

          if (parsed.is_error) {
            reject(new Error(`Claude CLI error: ${parsed.result}`))
            return
          }

          resolve({
            content: parsed.result,
            costUsd: parsed.cost_usd,
          })
        } catch {
          // JSON解析失敗時はテキスト出力として扱う
          resolve({ content: stdout.trim() })
        }
      },
    )
  })
}
