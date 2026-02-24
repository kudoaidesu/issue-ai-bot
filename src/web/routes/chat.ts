/**
 * チャットAPI — SSE ルート
 *
 * コアロジックは chat-service.ts に委譲し、
 * ここでは Hono の SSE ストリーミング変換とセッション管理のみ行う。
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, openSync, readSync, closeSync, createReadStream, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createChatStream, abortStream } from '../services/chat-service.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('web:chat')

// アクティブセッション管理（ファイル永続化）
export interface SessionEntry {
  sessionId: string
  project: string
  model: string
  lastUsed: number
  messagePreview: string
}

// プロジェクトルートの data/ に保存
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SESSIONS_FILE = join(projectRoot, 'data', 'sessions.json')

const sessions = new Map<string, SessionEntry>()

// 起動時にファイルから復元
function loadSessions(): void {
  try {
    const raw = readFileSync(SESSIONS_FILE, 'utf-8')
    const entries: Array<[string, SessionEntry]> = JSON.parse(raw)
    for (const [key, val] of entries) {
      sessions.set(key, val)
    }
    log.info(`Loaded ${sessions.size} sessions from disk`)
  } catch {
    // ファイルが無い場合は空で開始
  }
}

function persistSessions(): void {
  try {
    mkdirSync(dirname(SESSIONS_FILE), { recursive: true })
    writeFileSync(SESSIONS_FILE, JSON.stringify(Array.from(sessions.entries()), null, 2))
  } catch (e) {
    log.warn(`Failed to persist sessions: ${e}`)
  }
}

loadSessions()

// streamId → sessionId マッピング（中断用）
const streamToSession = new Map<string, string>()

export function getSessions(): SessionEntry[] {
  return Array.from(sessions.entries())
    .map(([key, val]) => ({ ...val, id: key }))
    .sort((a, b) => b.lastUsed - a.lastUsed)
}

/**
 * ~/.claude/projects/ からAgent SDKのセッションファイルを直接スキャン
 * cwdパスをハッシュ化したディレクトリ名でプロジェクトを特定
 */
function cwdToProjectDir(cwd: string): string {
  // Agent SDKはパスの / と _ を - に変換してディレクトリ名にする
  return cwd.replace(/[/_]/g, '-')
}

// SDKセッションスキャンキャッシュ（5秒TTL）
let sdkCache: { cwd: string; data: SessionEntry[]; ts: number } | null = null
const SDK_CACHE_TTL = 5000

function scanSdkSessions(cwd: string): SessionEntry[] {
  // キャッシュヒット
  if (sdkCache && sdkCache.cwd === cwd && Date.now() - sdkCache.ts < SDK_CACHE_TTL) {
    return sdkCache.data
  }

  const claudeDir = join(homedir(), '.claude', 'projects', cwdToProjectDir(cwd))
  const results: SessionEntry[] = []

  try {
    const files = readdirSync(claudeDir).filter(f => f.endsWith('.jsonl'))

    // stat情報を取得して最新50件に絞る
    const fileStats = files.map(f => {
      try {
        const s = statSync(join(claudeDir, f))
        return { file: f, mtime: s.mtimeMs }
      } catch { return null }
    }).filter((x): x is { file: string; mtime: number } => x !== null)
    fileStats.sort((a, b) => b.mtime - a.mtime)

    for (const { file, mtime } of fileStats) {
      const filePath = join(claudeDir, file)
      const sessionId = file.replace('.jsonl', '')

      try {
        // 先頭4KBだけ読んでuserメッセージを探す（大きいファイルでも高速）
        const buf = Buffer.alloc(4096)
        const fd = openSync(filePath, 'r')
        const bytesRead = readSync(fd, buf, 0, 4096, 0)
        closeSync(fd)
        const head = buf.toString('utf-8', 0, bytesRead)
        let preview = ''
        for (const line of head.split('\n')) {
          if (!line.trim()) continue
          try {
            const obj = JSON.parse(line)
            if (obj.type === 'user' && obj.message?.content) {
              const textContent = obj.message.content.find(
                (c: { type: string; text?: string }) => c.type === 'text'
              )
              if (textContent?.text) {
                preview = textContent.text.slice(0, 100)
                break
              }
            }
          } catch { /* skip malformed lines */ }
        }

        results.push({
          sessionId,
          project: cwd,
          model: '',
          lastUsed: mtime,
          messagePreview: preview || sessionId.slice(0, 12),
        })
      } catch { /* skip unreadable files */ }
    }
  } catch { /* directory doesn't exist */ }

  results.sort((a, b) => b.lastUsed - a.lastUsed)
  sdkCache = { cwd, data: results, ts: Date.now() }
  return results
}

/**
 * インメモリsessions + SDKファイルスキャンをマージ
 * インメモリに無いセッションはSDKから補完
 */
function getMergedSessions(cwd?: string): SessionEntry[] {
  const memSessions = getSessions()
  if (!cwd) return memSessions

  // インメモリセッションをプロジェクトでフィルタ
  const filtered = memSessions.filter(s => s.project === cwd)

  const sdkSessions = scanSdkSessions(cwd)
  const existingIds = new Set(filtered.map(s => s.sessionId))

  // SDKにしかないセッションを追加
  for (const sdk of sdkSessions) {
    if (!existingIds.has(sdk.sessionId)) {
      filtered.push({ ...sdk, id: sdk.sessionId.slice(0, 12) } as SessionEntry & { id: string })
    }
  }

  return filtered.sort((a, b) => b.lastUsed - a.lastUsed)
}

// --- 履歴メッセージ型 ---
interface HistoryMessage {
  role: 'user' | 'assistant'
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  toolUse?: { name: string; input: Record<string, unknown> }
  toolResult?: { output: string }
}

/** JSONL ファイルをストリーミング読み取りし、UI表示用メッセージ配列に変換 */
async function parseSessionJsonl(filePath: string): Promise<HistoryMessage[]> {
  const messages: HistoryMessage[] = []

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line) as {
        type?: string
        message?: {
          content?: Array<{
            type: string
            text?: string
            name?: string
            input?: Record<string, unknown>
            content?: string | Array<{ type: string; text?: string }>
            tool_use_id?: string
          }>
        }
      }

      const role = record.type as 'user' | 'assistant' | undefined
      if (!role || !record.message?.content) continue

      for (const c of record.message.content) {
        if (c.type === 'thinking') continue

        if (c.type === 'text' && c.text) {
          messages.push({ role, type: 'text', text: c.text })
        } else if (c.type === 'tool_use' && c.name) {
          messages.push({
            role: 'assistant',
            type: 'tool_use',
            toolUse: { name: c.name, input: c.input || {} },
          })
        } else if (c.type === 'tool_result') {
          let output = ''
          if (typeof c.content === 'string') {
            output = c.content
          } else if (Array.isArray(c.content)) {
            output = c.content
              .filter((x: { type: string; text?: string }) => x.type === 'text' && x.text)
              .map((x: { text?: string }) => x.text)
              .join('\n')
          }
          // 長い出力は切り詰め
          if (output.length > 3000) output = output.slice(0, 3000) + '\n... (truncated)'
          messages.push({ role: 'user', type: 'tool_result', toolResult: { output } })
        }
      }
    } catch { /* skip malformed lines */ }
  }

  return messages
}

export const chatRoutes = new Hono()

// POST /api/chat — SSEストリーミングでClaudeの応答を返す
chatRoutes.post('/', async (c) => {
  const body = await c.req.json<{
    message: string
    project?: string
    sessionId?: string
    model?: string
    planMode?: boolean
    permissionMode?: string
  }>()

  if (!body.message?.trim()) {
    return c.json({ error: 'message is required' }, 400)
  }

  const cwd = body.project || process.cwd()
  const model = body.model || 'sonnet'

  return streamSSE(c, async (stream) => {
    let currentStreamId = ''

    try {
      const chatStream = createChatStream({
        message: body.message,
        cwd,
        model,
        sessionId: body.sessionId,
        planMode: body.permissionMode === 'plan' || body.planMode,
        permissionMode: body.permissionMode,
      })

      let lastSessionId = body.sessionId || ''

      for await (const event of chatStream) {
        switch (event.type) {
          case 'session':
            if (event.sessionId) {
              lastSessionId = event.sessionId
            }
            await stream.writeSSE({
              event: 'session',
              data: JSON.stringify({ sessionId: event.sessionId, streamId: currentStreamId }),
            })
            break
          case 'text':
            await stream.writeSSE({ event: 'text', data: event.text })
            break
          case 'tool':
            await stream.writeSSE({
              event: 'tool',
              data: JSON.stringify({
                name: event.name,
                status: event.status,
                detail: event.detail,
              }),
            })
            break
          case 'warning':
            await stream.writeSSE({
              event: 'warning',
              data: JSON.stringify({ command: event.command, label: event.label }),
            })
            break
          case 'result':
            lastSessionId = event.sessionId || lastSessionId
            await stream.writeSSE({
              event: 'result',
              data: JSON.stringify({
                text: event.text,
                sessionId: lastSessionId,
                cost: event.cost,
                turns: event.turns,
                durationMs: event.durationMs,
                isError: event.isError,
              }),
            })
            break
          case 'error':
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({ message: event.message }),
            })
            break
          case 'status':
            await stream.writeSSE({
              event: 'status',
              data: JSON.stringify({ status: event.status, permissionMode: event.permissionMode }),
            })
            break
          case 'compact':
            await stream.writeSSE({
              event: 'compact',
              data: JSON.stringify({ trigger: event.trigger, preTokens: event.preTokens }),
            })
            break
        }
      }

      // セッション保存（ファイル永続化）
      if (lastSessionId) {
        const key = lastSessionId.slice(0, 12)
        sessions.set(key, {
          sessionId: lastSessionId,
          project: cwd,
          model,
          lastUsed: Date.now(),
          messagePreview: body.message.slice(0, 100),
        })
        // 古いセッションを削除（最大50件）
        if (sessions.size > 50) {
          const oldest = Array.from(sessions.entries())
            .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
          for (let i = 0; i < sessions.size - 50; i++) {
            sessions.delete(oldest[i][0])
          }
        }
        persistSessions()
      }
      if (currentStreamId) {
        streamToSession.delete(currentStreamId)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`Chat error: ${message}`)
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message }),
      })
    }
  })
})

// POST /api/chat/abort — ストリーム中断
chatRoutes.post('/abort', async (c) => {
  const { streamId } = await c.req.json<{ streamId?: string }>()
  if (!streamId) {
    return c.json({ error: 'streamId is required' }, 400)
  }
  const aborted = abortStream(streamId)
  return c.json({ aborted })
})

// GET /api/chat/sessions — セッション一覧（SDKファイルスキャン付き、ページング対応）
chatRoutes.get('/sessions', (c) => {
  const project = c.req.query('project')
  const offset = parseInt(c.req.query('offset') || '0', 10)
  const limit = parseInt(c.req.query('limit') || '20', 10)

  const all = getMergedSessions(project)
  const page = all.slice(offset, offset + limit)
  return c.json({ items: page, total: all.length, offset, limit })
})

// GET /api/chat/history/:sessionId — セッション会話履歴を返す
chatRoutes.get('/history/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const project = c.req.query('project')

  if (!sessionId || !project) {
    return c.json({ messages: [] })
  }

  const claudeDir = join(homedir(), '.claude', 'projects', cwdToProjectDir(project))
  const filePath = join(claudeDir, `${sessionId}.jsonl`)

  if (!existsSync(filePath)) {
    return c.json({ messages: [] })
  }

  try {
    const messages = await parseSessionJsonl(filePath)
    return c.json({ messages })
  } catch (e) {
    log.warn(`Failed to parse session history: ${e}`)
    return c.json({ messages: [] })
  }
})

