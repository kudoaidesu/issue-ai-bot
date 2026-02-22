import { spawn } from 'node:child_process'
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
      args.push('--append-system-prompt', options.systemPrompt)
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

    // CLAUDECODE 環境変数を除去して子プロセスを起動
    // （Claude Code内でBot開発中にネストセッションエラーを防止）
    const { CLAUDECODE: _, ...cleanEnv } = process.env
    const proc = spawn('claude', args, {
      cwd: options.cwd ?? process.cwd(),
      stdio: ['inherit', 'pipe', 'pipe'],
      env: cleanEnv,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error(`Claude CLI timed out after ${options.timeoutMs ?? 300_000}ms`))
    }, options.timeoutMs ?? 5 * 60 * 1000)

    proc.on('close', (code) => {
      clearTimeout(timeout)

      if (stderr) {
        log.warn(`stderr: ${stderr.slice(0, 200)}`)
      }

      if (code !== 0) {
        log.error(`Claude CLI exited with code ${code}`)
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr.slice(0, 500)}`))
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
    })
  })
}
