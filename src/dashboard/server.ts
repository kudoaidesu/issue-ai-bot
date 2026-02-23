import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'
import { listChannels, getConversation, getCosts, getAudit } from './api.js'
import { renderDashboard } from './html.js'

const log = createLogger('dashboard')

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendHtml(res: ServerResponse, html: string): void {
  const body = html
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
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

    // GET /api/costs — コスト情報
    if (path === '/api/costs' && req.method === 'GET') {
      sendJson(res, getCosts())
      return
    }

    // GET /api/audit — 監査ログ
    if (path === '/api/audit' && req.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? '100')
      sendJson(res, getAudit(Math.min(limit, 500)).slice().reverse())
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
