import { createLogger } from '../utils/logger.js'

const log = createLogger('claude-sdk')

export interface ClaudeSdkOptions {
  prompt: string
  systemPrompt?: string
  model?: string
  maxTurns?: number
  cwd?: string
  allowedTools?: string[]
  resume?: string
  forkSession?: boolean
  settingSources?: string[]
  permissionMode?: string
  timeoutMs?: number
}

export interface ClaudeSdkResult {
  content: string
  sessionId?: string
}

// Agent SDK V1 メッセージ型（公式ドキュメント準拠）
interface SdkMessage {
  type: string
  subtype?: string
  session_id?: string
  role?: string
  message?: {
    role: string
    content: Array<{ type: string; text?: string }>
  }
  // result message fields
  result?: string
  total_cost_usd?: number
  is_error?: boolean
  // legacy flat format (backward compat)
  content?: Array<{ type: string; text?: string }>
  cost_usd?: number
}

interface SdkQueryParams {
  prompt: string
  options: Record<string, unknown>
}

interface SdkModule {
  query: (params: SdkQueryParams) => AsyncIterable<SdkMessage>
}

let cachedModule: SdkModule | null = null

async function loadSdk(): Promise<SdkModule> {
  if (cachedModule) return cachedModule

  // ネストセッション防止チェックを回避（Claude Code内からSDKを呼ぶ場合）
  delete process.env.CLAUDECODE

  try {
    cachedModule = await import(/* webpackIgnore: true */ '@anthropic-ai/claude-agent-sdk') as SdkModule
    return cachedModule
  } catch {
    // fall through
  }

  throw new Error(
    'Claude Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk',
  )
}

function extractTextFromMessage(msg: SdkMessage): string {
  // V1 format: msg.message.content
  if (msg.message?.content) {
    return msg.message.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('')
  }
  // Legacy flat format: msg.content
  if (msg.content && Array.isArray(msg.content)) {
    return msg.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('')
  }
  return ''
}

export async function runClaudeSdk(options: ClaudeSdkOptions): Promise<ClaudeSdkResult> {
  const sdk = await loadSdk()

  const resumeInfo = options.resume ? ` (resume: ${options.resume.slice(0, 12)}...)` : ''
  log.info(`Executing SDK${resumeInfo}: "${options.prompt.slice(0, 60)}..."`)

  const queryOptions: Record<string, unknown> = {
    model: options.model,
    maxTurns: options.maxTurns ?? 3,
    cwd: options.cwd,
  }

  if (options.systemPrompt) {
    queryOptions.systemPrompt = options.systemPrompt
  }
  if (options.allowedTools && options.allowedTools.length > 0) {
    queryOptions.allowedTools = options.allowedTools
  }
  if (options.resume) {
    queryOptions.resume = options.resume
  }
  if (options.forkSession) {
    queryOptions.forkSession = options.forkSession
  }
  if (options.settingSources) {
    queryOptions.settingSources = options.settingSources
  }
  if (options.permissionMode) {
    queryOptions.permissionMode = options.permissionMode
  }

  let sessionId: string | undefined
  let content = ''

  const abortController = new AbortController()
  queryOptions.abortController = abortController

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  if (options.timeoutMs) {
    timeoutId = setTimeout(() => abortController.abort(), options.timeoutMs)
  }

  try {
    const stream = sdk.query({
      prompt: options.prompt,
      options: queryOptions,
    })

    for await (const msg of stream) {
      // session_id は全メッセージに含まれる — 最初に見つけたものを保持
      if (msg.session_id && !sessionId) {
        sessionId = msg.session_id
      }

      // system/init — セッション情報
      if (msg.type === 'system' && msg.subtype === 'init') {
        if (msg.session_id) {
          sessionId = msg.session_id
        }
        log.info(`Session initialized: ${sessionId}`)
      }

      // assistant — テキスト応答を蓄積
      if (msg.type === 'assistant') {
        const text = extractTextFromMessage(msg)
        if (text) {
          content += text
        }
      }

      // result — 最終結果
      if (msg.type === 'result') {
        if (msg.session_id) {
          sessionId = msg.session_id
        }
        // result message に最終テキストがある場合
        if (msg.result && !content) {
          content = msg.result
        }
      }
    }
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }

  log.info(
    `SDK completed: ${content.length} chars, session=${sessionId?.slice(0, 12) ?? 'none'}`,
  )

  return { content, sessionId }
}
