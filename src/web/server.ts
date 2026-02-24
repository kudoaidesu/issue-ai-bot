/**
 * Web サーバー — Hono + Tailscaleバインド
 *
 * Tailscaleインターフェースのみにバインドし、ローカルポートは公開しない。
 * 認証はTailscaleのACLに委譲する。
 * 起動: npx tsx src/web/server.ts
 */
import 'dotenv/config'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { serve } from '@hono/node-server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chatRoutes } from './routes/chat.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('web:server')

// --- 設定 ---
const PORT = Number(process.env.WEB_PORT || '3100')
const HOST = process.env.WEB_HOST || '100.116.180.63' // Tailscale IP

// --- プロジェクト一覧（projects.json から読み込み） ---
interface ProjectEntry {
  slug: string
  repo: string
  localPath: string
}

function loadProjects(): ProjectEntry[] {
  try {
    const raw = readFileSync(resolve(process.cwd(), 'projects.json'), 'utf-8')
    const parsed = JSON.parse(raw) as Array<{ slug: string; repo: string; localPath: string }>
    return parsed.map((p) => ({ slug: p.slug, repo: p.repo, localPath: p.localPath }))
  } catch {
    return []
  }
}

// --- Hono アプリ ---
const app = new Hono()

// CORS（Tailscale内のみだが念のため）
app.use('*', cors())

// 静的ファイル配信
app.use('/static/*', serveStatic({ root: resolve(process.cwd(), 'src/web/public'), rewriteRequestPath: (path) => path.replace('/static', '') }))

// --- API ルート ---

// チャット（SSEストリーミング）
app.route('/api/chat', chatRoutes)

// プロジェクト一覧
app.get('/api/projects', (c) => {
  return c.json(loadProjects())
})

// ヘルスチェック
app.get('/api/health', (c) => {
  return c.json({ ok: true, timestamp: Date.now() })
})

// --- SPA フォールバック ---
app.get('*', (c) => {
  try {
    const html = readFileSync(resolve(process.cwd(), 'src/web/public/index.html'), 'utf-8')
    return c.html(html)
  } catch {
    return c.text('index.html not found', 404)
  }
})

// --- サーバー起動 ---
log.info(`Starting web server on ${HOST}:${PORT} (Tailscale only)`)

serve({
  fetch: app.fetch,
  hostname: HOST,
  port: PORT,
})

log.info(`Web server running: http://${HOST}:${PORT}`)
