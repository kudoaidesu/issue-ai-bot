import { evaluateToolUse } from './tool-guard.js'
import { appendAudit } from '../utils/audit.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('security-hooks')

export interface ToolUseRequest {
  tool_name: string
  tool_input: Record<string, unknown>
}

/**
 * Agent SDK の canUseTool コールバックとして使用する。
 * ツール実行前に呼ばれ、allow/block を判定する。
 */
export function canUseTool(request: ToolUseRequest): boolean {
  const toolName = request.tool_name
  // tool_input をフラットな文字列に変換して検査
  const inputStr = JSON.stringify(request.tool_input)

  const result = evaluateToolUse(toolName, inputStr)

  if (!result.allowed) {
    log.warn(`Tool use denied: ${toolName} — ${result.reason}`)
    return false
  }

  // 許可されたツール使用も記録（サンプリング: Bashのみ）
  if (toolName === 'Bash' || toolName === 'bash') {
    appendAudit({
      action: 'tool_allowed',
      actor: 'security-hooks',
      detail: `${toolName}: ${inputStr.slice(0, 200)}`,
      result: 'allow',
    })
  }

  return true
}
