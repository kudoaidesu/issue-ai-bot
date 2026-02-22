import { createLogger } from '../utils/logger.js'
import { appendAudit } from '../utils/audit.js'

const log = createLogger('tool-guard')

// 危険なコマンドパターン（正規表現）
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /rm\s+-rf\s+[/~]/, description: 'rm -rf on root or home' },
  { pattern: /git\s+push\s+--force/, description: 'git force push' },
  { pattern: /git\s+reset\s+--hard/, description: 'git reset --hard' },
  { pattern: /DROP\s+(?:TABLE|DATABASE)/i, description: 'SQL DROP statement' },
  { pattern: /TRUNCATE\s+TABLE/i, description: 'SQL TRUNCATE statement' },
  { pattern: /DELETE\s+FROM\s+\w+\s*(?:;|$)/i, description: 'SQL DELETE without WHERE' },
  { pattern: /chmod\s+777/, description: 'chmod 777' },
  { pattern: /curl\s+.*\|\s*(?:ba)?sh/, description: 'pipe curl to shell' },
  { pattern: /eval\s*\(/, description: 'eval execution' },
  { pattern: />\s*\/dev\/sd[a-z]/, description: 'write to block device' },
  { pattern: /mkfs\./, description: 'filesystem format' },
  { pattern: /:(){ :\|:& };:/, description: 'fork bomb' },
]

// 保護されたファイルパターン
const PROTECTED_FILES: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\.env(?:\.|$)/, description: '.env file' },
  { pattern: /credentials?\./i, description: 'credentials file' },
  { pattern: /(?:^|\/)\.ssh\//, description: '.ssh directory' },
  { pattern: /(?:^|\/)\.gnupg\//, description: '.gnupg directory' },
  { pattern: /(?:^|\/)\.aws\//, description: '.aws directory' },
  { pattern: /id_rsa/, description: 'SSH private key' },
  { pattern: /\.pem$/, description: 'PEM certificate' },
]

export type ToolGuardResult = {
  allowed: boolean
  reason?: string
}

export function evaluateToolUse(toolName: string, input: string): ToolGuardResult {
  // Bash / shell コマンドのチェック
  if (toolName === 'Bash' || toolName === 'bash' || toolName === 'shell') {
    for (const { pattern, description } of BLOCKED_PATTERNS) {
      if (pattern.test(input)) {
        const result = { allowed: false, reason: `Blocked: ${description}` }
        log.warn(`Tool blocked: ${toolName} — ${description}`)
        appendAudit({
          action: 'tool_blocked',
          actor: 'tool-guard',
          detail: `${toolName}: ${description} — input: ${input.slice(0, 200)}`,
          result: 'block',
        })
        return result
      }
    }
  }

  // ファイル操作ツールのチェック
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
    for (const { pattern, description } of PROTECTED_FILES) {
      if (pattern.test(input)) {
        const result = { allowed: false, reason: `Protected file: ${description}` }
        log.warn(`File access blocked: ${description}`)
        appendAudit({
          action: 'file_access_blocked',
          actor: 'tool-guard',
          detail: `${toolName}: ${description} — path: ${input.slice(0, 200)}`,
          result: 'block',
        })
        return result
      }
    }
  }

  return { allowed: true }
}
