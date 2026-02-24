/**
 * チャットAPI — SSE ルート
 *
 * コアロジックは chat-service.ts に委譲し、
 * ここでは Hono の SSE ストリーミング変換とセッション管理のみ行う。
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { createChatStream, abortStream } from '../services/chat-service.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('web:chat')

// アクティブセッション管理（インメモリ）
export interface SessionEntry {
  sessionId: string
  project: string
  model: string
  lastUsed: number
  messagePreview: string
}

const sessions = new Map<string, SessionEntry>()

// streamId → sessionId マッピング（中断用）
const streamToSession = new Map<string, string>()

export function getSessions(): SessionEntry[] {
  return Array.from(sessions.entries())
    .map(([key, val]) => ({ ...val, id: key }))
    .sort((a, b) => b.lastUsed - a.lastUsed)
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
        planMode: body.planMode,
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

      // セッション保存
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

// GET /api/chat/sessions — セッション一覧
chatRoutes.get('/sessions', (c) => {
  return c.json(getSessions())
})

// DELETE /api/chat/sessions/:id — セッション削除
chatRoutes.delete('/sessions/:id', (c) => {
  const id = c.req.param('id')
  const deleted = sessions.delete(id)
  return c.json({ deleted })
})
