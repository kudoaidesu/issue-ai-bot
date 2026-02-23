import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'
import { listChannels, getConversation, getAudit } from './api.js'
import { renderDashboard } from './html.js'
import { processImmediate } from '../queue/scheduler.js'
import { enqueue } from '../queue/processor.js'

const log = createLogger('dashboard')

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function sendHtml(res: ServerResponse, html: string): void {
  const body = html
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const path = url.pathname

  try {
    // GET / — HTML ダッシュボード
    if (path === '/' && req.method === 'GET') {
      const channels = listChannels()
      sendHtml(res, renderDashboard(channels))
      return
    }

    // GET /api/conversations — チャンネル一覧
    if (path === '/api/conversations' && req.method === 'GET') {
      sendJson(res, listChannels())
      return
    }

    // GET /api/conversations/:guildId/:channelId — 会話履歴
    const convMatch = path.match(/^\/api\/conversations\/([^/]+)\/([^/]+)$/)
    if (convMatch && req.method === 'GET') {
      const [, guildId, channelId] = convMatch
      const limit = Number(url.searchParams.get('limit') ?? '50')
      sendJson(res, getConversation(guildId, channelId, Math.min(limit, 500)))
      return
    }

    // GET /api/audit — 監査ログ
    if (path === '/api/audit' && req.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? '100')
      sendJson(res, getAudit(Math.min(limit, 500)).slice().reverse())
      return
    }

    // POST /api/process-immediate — 即時処理（ショーグンのBashツール経由で使用）
    if (path === '/api/process-immediate' && req.method === 'POST') {
      const body = await readBody(req)
      const { issueNumber, repository } = JSON.parse(body) as { issueNumber: number; repository: string }

      const result = await processImmediate(issueNumber, repository)

      if (result.status === 'started') {
        sendJson(res, { status: 'started' })
      } else {
        // ロック中 or ハンドラ未登録 → 高優先度キューに追加してフォールバック
        enqueue(issueNumber, repository, 'high')
        sendJson(res, { status: result.status, fallback: 'queued_high' })
      }
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  } catch (err) {
    log.error('Dashboard request error', err)
    sendJson(res, { error: 'Internal Server Error' }, 500)
  }
}

export function startDashboard(): Server {
  const server = createServer(handleRequest)
  const { host, port } = config.dashboard
  server.listen(port, host, () => {
    log.info(`Dashboard running at http://${host}:${port}`)
  })
  return server
}
