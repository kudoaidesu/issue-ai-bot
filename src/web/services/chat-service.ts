/**
 * チャットサービス — Agent SDK を Claude Code CLI 相当の設定で実行
 *
 * Hono ルートから分離し、テスト可能にした純粋なロジック層。
 * settingSources: ['project', 'user'] で CLAUDE.md / .claude/rules/ / ユーザー設定を自動読み込みし、
 * Claude Code CLI と同等の振る舞いを実現する。
 */
import { detectDanger } from '../danger-detect.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('web:chat-service')

// ── 型定義 ──────────────────────────────────────────

export interface ChatParams {
  message: string
  cwd: string
  model: string
  sessionId?: string
  planMode?: boolean
  permissionMode?: string
}

export interface ToolDetail {
  name: string
  input?: Record<string, unknown>
  output?: string
}

export type ChatEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; status: string; detail?: ToolDetail }
  | { type: 'warning'; command: string; label: string }
  | { type: 'result'; text: string; sessionId: string; cost?: number; turns?: number; durationMs?: number; isError?: boolean }
  | { type: 'error'; message: string }
  | { type: 'status'; status: string; permissionMode?: string }
  | { type: 'compact'; trigger: string; preTokens?: number }

/** Agent SDK から返される生メッセージ */
export interface SdkMessage {
  type: string
  subtype?: string // 'init' | 'compact_boundary' | 'status' etc.
  session_id?: string
  status?: string
  permissionMode?: string
  compact_metadata?: { trigger?: string; pre_tokens?: number }
  message?: {
    role: string
    content: Array<{
      type: string
      text?: string
      name?: string
      input?: Record<string, unknown>
      content?: string | Array<{ type: string; text?: string }>
    }>
  }
  result?: string
  total_cost_usd?: number
  is_error?: boolean
  num_turns?: number
  duration_ms?: number
  event?: {
    type: string
    delta?: { type: string; text?: string }
    content_block?: { type: string; name?: string }
  }
}

// ── SDK ローダー ────────────────────────────────────

interface SdkModule {
  query: (params: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<SdkMessage>
}

let sdkModule: SdkModule | null = null

async function loadSdk(): Promise<SdkModule> {
  if (sdkModule) return sdkModule
  delete process.env.CLAUDECODE
  sdkModule = await import('@anthropic-ai/claude-agent-sdk') as SdkModule
  return sdkModule
}

// ── Query Options ビルダー（テスト可能） ──────────────

export function buildQueryOptions(params: ChatParams): Record<string, unknown> {
  // permissionMode mapping:
  //   'default'     → bypassPermissions (個人サーバーのデフォルト)
  //   'plan'        → plan (計画モード)
  //   'auto-accept' → acceptEdits (編集のみ自動承認)
  //   'yolo'        → bypassPermissions + dangerouslySkipPermissions (全ツール無制限)
  const mode = params.permissionMode || (params.planMode ? 'plan' : 'default')
  const sdkMode = mode === 'plan' ? 'plan'
    : mode === 'auto-accept' ? 'acceptEdits'
    : 'bypassPermissions'
  const options: Record<string, unknown> = {
    cwd: params.cwd,
    model: params.model,
    permissionMode: sdkMode,
    allowDangerouslySkipPermissions: mode === 'default' || mode === 'yolo',
    includePartialMessages: true,
    // Claude Code CLI 相当: プロジェクト設定 + ユーザー設定を自動読み込み
    settingSources: ['project', 'user'],
    // Claude Code 標準のシステムプロンプトをそのまま使用
    systemPrompt: { type: 'preset', preset: 'claude_code' },
  }

  if (params.sessionId) {
    options.resume = params.sessionId
  }

  return options
}

// ── SDK メッセージ → ChatEvent パーサー（テスト可能） ──

export function parseSdkMessage(msg: SdkMessage, currentSessionId: string): ChatEvent[] {
  const events: ChatEvent[] = []

  // セッションID取得（初回）
  if (msg.session_id && !currentSessionId) {
    events.push({ type: 'session', sessionId: msg.session_id })
  }

  // system/init
  if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
    events.push({ type: 'session', sessionId: msg.session_id })
  }

  // system/compact_boundary — コンパクティング完了
  if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
    events.push({
      type: 'compact',
      trigger: msg.compact_metadata?.trigger || 'auto',
      preTokens: msg.compact_metadata?.pre_tokens,
    })
  }

  // system/status — ステータス変更（compacting, permissionMode等）
  if (msg.type === 'system' && msg.subtype === 'status') {
    if (msg.status || msg.permissionMode) {
      events.push({ type: 'status', status: msg.status || '', permissionMode: msg.permissionMode })
    }
  }

  // ストリーミングテキスト
  if (msg.type === 'stream_event' && msg.event) {
    const evt = msg.event
    if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
      events.push({ type: 'text', text: evt.delta.text })
    }
    if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use' && evt.content_block.name) {
      events.push({ type: 'tool', name: evt.content_block.name, status: 'start' })
    }
  }

  // ツール詳細 + 危険コマンド検知
  if (msg.type === 'assistant' && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === 'tool_use' && block.name) {
        const detail: ToolDetail = { name: block.name, input: block.input }
        events.push({ type: 'tool', name: block.name, status: 'input', detail })

        if (block.name === 'Bash' && block.input) {
          const cmd = (block.input as Record<string, string>).command || ''
          const danger = detectDanger(cmd)
          if (danger) {
            log.warn(`Dangerous command executed: ${danger.label} — ${danger.command}`)
            events.push({ type: 'warning', command: danger.command, label: danger.label })
          }
        }
      }
      if (block.type === 'tool_result' && block.name) {
        const outputText = typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content.filter(c => c.type === 'text').map(c => c.text || '').join('\n')
            : ''
        const detail: ToolDetail = { name: block.name, output: outputText }
        events.push({ type: 'tool', name: block.name, status: 'output', detail })
      }
    }
  }

  // 最終結果
  if (msg.type === 'result') {
    const sessionId = msg.session_id || currentSessionId
    events.push({
      type: 'result',
      text: msg.result || '',
      sessionId,
      cost: msg.total_cost_usd,
      turns: msg.num_turns,
      durationMs: msg.duration_ms,
      isError: msg.is_error,
    })
  }

  return events
}

// ── 中断管理 ─────────────────────────────────────────

const activeStreams = new Map<string, AbortController>()

export function abortStream(streamId: string): boolean {
  const controller = activeStreams.get(streamId)
  if (controller) {
    controller.abort()
    activeStreams.delete(streamId)
    return true
  }
  return false
}

export function getActiveStreamIds(): string[] {
  return Array.from(activeStreams.keys())
}

// ── メインストリーム ─────────────────────────────────

export async function* createChatStream(params: ChatParams): AsyncGenerator<ChatEvent> {
  const sdk = await loadSdk()
  const options = buildQueryOptions(params)
  const abortController = new AbortController()
  const streamId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  activeStreams.set(streamId, abortController)

  // AbortSignal を options に追加
  options.abortController = abortController

  log.info(`Chat request [${streamId}]: "${params.message.slice(0, 60)}..." cwd=${params.cwd} model=${params.model}`)

  // streamId を最初に通知
  yield { type: 'session', sessionId: '' } as ChatEvent & { streamId?: string }

  const queryStream = sdk.query({ prompt: params.message, options })
  let sessionId = params.sessionId || ''

  try {
    for await (const msg of queryStream) {
      if (abortController.signal.aborted) {
        yield { type: 'error', message: 'Aborted by user' }
        break
      }
      const events = parseSdkMessage(msg, sessionId)
      for (const event of events) {
        if (event.type === 'session') {
          sessionId = event.sessionId
        }
        yield event
      }
    }
  } finally {
    activeStreams.delete(streamId)
  }
}
