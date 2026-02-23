import { appendFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { config } from '../config.js'
import { createLogger } from './logger.js'

const log = createLogger('usage-monitor')

// --- Types ---

export type UsageProvider = 'claude' | 'codex'

/** Claude の5時間セッション枠 */
export interface SessionLimit {
  /** 現在のセッション使用率 (0-100)。rate-limited 時は 100 */
  usagePercent: number
  /** 残り時間テキスト (例: "4h 32m remaining") */
  remaining?: string
  /** セッション制限中かどうか */
  rateLimited: boolean
}

/** Claude の週間モデル別使用量 */
export interface WeeklyModelUsage {
  model: string
  /** 使用時間テキスト (例: "12h of 140-280h") */
  usageText?: string
  /** 使用率 (0-100) */
  usagePercent?: number
}

/** Claude の週間使用量 */
export interface WeeklyLimit {
  /** 週間リセット日時テキスト */
  resetAt?: string
  /** モデル別使用量 */
  models: WeeklyModelUsage[]
  /** 週の何日目か (0=リセット日) */
  dayOfWeek?: number
}

export interface ClaudeParsed {
  session: SessionLimit | null
  weekly: WeeklyLimit | null
  raw: string
}

export interface CodexParsed {
  /** 使用率テキスト (例: "12 of 50 tasks") */
  usageText?: string
  usagePercent?: number
  resetAt?: string
  raw: string
}

export interface UsageSnapshot {
  timestamp: string
  provider: UsageProvider
  raw: string
  claude?: ClaudeParsed
  codex?: CodexParsed
  error?: string
}

export interface UsageReport {
  claude: UsageSnapshot | null
  codex: UsageSnapshot | null
  scrapedAt: string
}

/** アラート判定結果 */
export interface UsageAlerts {
  /** 週間ペース超過（週間上限÷7×経過日数を超えている） */
  weeklyPaceExceeded: boolean
  weeklyPaceDetail?: string
  /** Sonnet の週間ペース超過 */
  sonnetPaceExceeded: boolean
  sonnetPaceDetail?: string
  /** 5時間セッション制限中 */
  sessionRateLimited: boolean
  sessionDetail?: string
  /** 起床時間（09:00）に5時間枠が回復しない見込み */
  wakeTimeConflict: boolean
  wakeTimeDetail?: string
  /** Codex ペース超過 */
  codexPaceExceeded: boolean
  codexPaceDetail?: string
  /** いずれかのアラートが発火しているか */
  hasAlerts: boolean
}

// --- JSONL Storage ---

const usageFilePath = join(config.queue.dataDir, 'usage.jsonl')

function ensureDir(): void {
  const dir = dirname(usageFilePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function appendSnapshot(snapshot: UsageSnapshot): void {
  ensureDir()
  appendFileSync(usageFilePath, JSON.stringify(snapshot) + '\n', 'utf-8')
}

function readAllSnapshots(): UsageSnapshot[] {
  if (!existsSync(usageFilePath)) return []
  const lines = readFileSync(usageFilePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
  return lines.map((line) => JSON.parse(line) as UsageSnapshot)
}

// --- Browser Management ---

interface PlaywrightModule {
  chromium: {
    launchPersistentContext: (
      userDataDir: string,
      options: Record<string, unknown>,
    ) => Promise<BrowserContext>
  }
}

interface BrowserContext {
  pages: () => Page[]
  newPage: () => Promise<Page>
  close: () => Promise<void>
}

interface Page {
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>
  url: () => string
  waitForTimeout: (ms: number) => Promise<void>
  evaluate: <T>(fn: () => T) => Promise<T>
}

async function createBrowserContext(): Promise<BrowserContext> {
  const { chromium } = (await import('playwright')) as unknown as PlaywrightModule
  const userDataDir = config.usageMonitor.chromeUserDataDir

  if (!existsSync(userDataDir)) {
    mkdirSync(userDataDir, { recursive: true })
  }

  // 前回のプロセスが異常終了した場合に残る SingletonLock を削除する
  // 残っていると "Failed to create a ProcessSingleton" で起動失敗しクラッシュにつながる
  const singletonLock = resolve(userDataDir, 'SingletonLock')
  if (existsSync(singletonLock)) {
    unlinkSync(singletonLock)
    log.warn('Removed stale Chrome SingletonLock before launch')
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--window-size=1,1',
      '--window-position=0,0',
    ],
    timeout: config.usageMonitor.timeoutMs,
  })

  // macOS: Chromium ウィンドウを裏に回してフォーカスを奪わない
  minimizeBrowserWindow()

  return context
}

/** macOS: Playwright Chromium ウィンドウを非表示にしてフォーカスを奪わないようにする */
function minimizeBrowserWindow(): void {
  if (process.platform !== 'darwin') return

  // 少し待ってからウィンドウを非表示（起動直後はまだウィンドウが出来ていない）
  setTimeout(() => {
    // Playwright の Chromium は "Google Chrome for Testing" というプロセス名
    const script = `
      tell application "System Events"
        set targetNames to {"Google Chrome for Testing", "Chromium", "Google Chrome"}
        repeat with pName in targetNames
          if exists (process pName) then
            set visible of process pName to false
            return "hidden: " & pName
          end if
        end repeat
        return "no chrome process found"
      end tell
    `
    execFile('osascript', ['-e', script], (err, stdout) => {
      if (err) {
        log.warn(`Failed to hide browser window: ${err.message}`)
      } else {
        log.info(`Browser window: ${stdout.trim()}`)
      }
    })
  }, 1500)
}

// --- Scraping ---

async function scrapeClaudeUsage(page: Page): Promise<UsageSnapshot> {
  const timestamp = new Date().toISOString()
  try {
    await page.goto(config.usageMonitor.claudeUsageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.usageMonitor.timeoutMs,
    })

    // SPA のレンダリング待ち
    await page.waitForTimeout(8000)

    if (page.url().includes('/login')) {
      return {
        timestamp,
        provider: 'claude',
        raw: '',
        error: '認証切れ — npm run setup:usage で再ログインしてください',
      }
    }

    const raw = await page.evaluate(() => {
      const main = document.querySelector('main') ?? document.body
      return main.innerText
    })

    const claude = parseClaudeUsage(raw)
    return { timestamp, provider: 'claude', raw, claude }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`Claude usage scrape failed: ${message}`)
    return { timestamp, provider: 'claude', raw: '', error: message }
  }
}

async function scrapeCodexUsage(page: Page): Promise<UsageSnapshot> {
  const timestamp = new Date().toISOString()
  try {
    await page.goto(config.usageMonitor.codexUsageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.usageMonitor.timeoutMs,
    })

    // SPA のレンダリング待ち
    await page.waitForTimeout(8000)

    if (page.url().includes('/auth/login') || page.url().includes('/login')) {
      return {
        timestamp,
        provider: 'codex',
        raw: '',
        error: '認証切れ — npm run setup:usage で再ログインしてください',
      }
    }

    const raw = await page.evaluate(() => {
      const main = document.querySelector('main') ?? document.body
      return main.innerText
    })

    const codex = parseCodexUsage(raw)
    return { timestamp, provider: 'codex', raw, codex }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`Codex usage scrape failed: ${message}`)
    return { timestamp, provider: 'codex', raw: '', error: message }
  }
}

// --- Parsing ---
//
// 実ページ例 (Claude, 日本語):
//   現在のセッション\n4時間8分後にリセット\n10% 使用済み\n
//   すべてのモデル\n16:00 (日)にリセット\n4% 使用済み\n
//   Sonnetのみ\n15:00 (水)にリセット\n38% 使用済み
//
// 実ページ例 (Codex, 日本語):
//   5時間の使用制限\n99%\n残り\nリセット：2026/02/23 0:30\n
//   週あたりの使用制限\n26%\n残り\nリセット：2026/02/25 9:16

function parseClaudeUsage(raw: string): ClaudeParsed {
  let session: SessionLimit | null = null
  let weekly: WeeklyLimit | null = null

  // --- Session parsing ---
  // 「現在のセッション」〜 次のセクションまでを切り出し
  const sessionMatch = raw.match(
    /(?:現在のセッション|current\s+session)([\s\S]*?)(?=\n(?:週間|weekly|すべて|all\s+model|sonnet|opus)|$)/i,
  )

  if (sessionMatch) {
    const block = sessionMatch[1]

    // "10% 使用済み" or "10% used"
    const percentMatch = block.match(/(\d{1,3})\s*%/)
    const usagePercent = percentMatch ? Number(percentMatch[1]) : 0

    // "4時間8分後にリセット" or "Resets in 4h 8m"
    const remainingJa = block.match(/(\d+時間\d*分?)後/)
    const remainingEn = block.match(/([\dh\sm]+)\s*(?:remaining|left)/i)
    const remaining = remainingJa?.[1] ?? remainingEn?.[1]?.trim()

    const rateLimited =
      usagePercent >= 100 ||
      block.includes('制限') ||
      block.toLowerCase().includes('limit reached')

    session = { usagePercent, remaining, rateLimited }
  }

  // --- Weekly parsing ---
  const models: WeeklyModelUsage[] = []

  // 「すべてのモデル」(= Opus 含む全モデル) セクション
  const allModelsMatch = raw.match(
    /(?:すべてのモデル|all\s+model)([\s\S]*?)(?=\n(?:sonnet|opus|最終|追加|$))/i,
  )
  if (allModelsMatch) {
    const block = allModelsMatch[1]
    const pct = block.match(/(\d{1,3})\s*%/)
    if (pct) {
      models.push({ model: 'All', usagePercent: Number(pct[1]) })
    }
  }

  // 「Sonnetのみ」セクション
  const sonnetMatch = raw.match(
    /(?:sonnet(?:のみ)?)([\s\S]*?)(?=\n(?:opus|最終|追加|$))/i,
  )
  if (sonnetMatch) {
    const block = sonnetMatch[1]
    const pct = block.match(/(\d{1,3})\s*%/)
    if (pct) {
      models.push({ model: 'Sonnet', usagePercent: Number(pct[1]) })
    }
  }

  // 「Opusのみ」セクション（存在する場合）
  const opusMatch = raw.match(
    /(?:opus(?:のみ)?)([\s\S]*?)(?=\n(?:sonnet|最終|追加|$))/i,
  )
  if (opusMatch) {
    const block = opusMatch[1]
    const pct = block.match(/(\d{1,3})\s*%/)
    if (pct) {
      models.push({ model: 'Opus', usagePercent: Number(pct[1]) })
    }
  }

  // リセット日時: "16:00 (日)にリセット" — 最初の週間セクションから取得
  const resetMatch = raw.match(
    /(?:すべてのモデル|all\s+model)[\s\S]*?(\d{1,2}:\d{2}\s*\([日月火水木金土]\))にリセット/i,
  ) ?? raw.match(/resets?\s+(?:on\s+)?(.+?)(?:\.|$|\n)/i)
  const resetAt = resetMatch ? resetMatch[1].trim() : undefined

  // 曜日から経過日数を計算
  let dayOfWeek: number | undefined
  const jpDayMatch = resetAt?.match(/\(([日月火水木金土])\)/)
  if (jpDayMatch) {
    const jpDays: Record<string, number> = {
      '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6,
    }
    const resetDayNum = jpDays[jpDayMatch[1]] ?? 0
    const now = new Date()
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
    const currentDay = jstNow.getUTCDay() // 0=Sun
    dayOfWeek = (currentDay - resetDayNum + 7) % 7
    if (dayOfWeek === 0) dayOfWeek = 7 // リセット当日 = 7日目（週末）
  }

  if (resetAt || models.length > 0) {
    weekly = { resetAt, models, dayOfWeek }
  }

  return { session, weekly, raw }
}

function parseCodexUsage(raw: string): CodexParsed {
  let usageText: string | undefined
  let usagePercent: number | undefined
  let resetAt: string | undefined

  // 「5時間の使用制限」セクション — セッション的な制限
  // 「週あたりの使用制限」セクション — 週間制限
  // 両方にパーセンテージがある。週間の方をメインに使う

  // 週間制限を優先的に取得
  const weeklyMatch = raw.match(
    /(?:週あたりの使用制限|weekly\s+usage\s+limit)([\s\S]*?)(?=\n(?:コードレビュー|code\s*review|残りのクレジット|$))/i,
  )
  if (weeklyMatch) {
    const block = weeklyMatch[1]
    const pct = block.match(/(\d{1,3})\s*%/)
    if (pct) {
      // Codex の表示は「残り」パーセント。使用率に変換
      usagePercent = 100 - Number(pct[1])
      usageText = `${usagePercent}% 使用済み (残り ${pct[1]}%)`
    }
    const resetMatch = block.match(/リセット[：:]\s*(.+?)(?:\n|$)/)
      ?? block.match(/resets?\s*[：:]?\s*(.+?)(?:\n|$)/i)
    if (resetMatch) {
      resetAt = resetMatch[1].trim()
    }
  }

  // 週間が取れなかったらフォールバック: 最初のパーセンテージ
  if (usagePercent === undefined) {
    const pct = raw.match(/(\d{1,3})\s*%/)
    if (pct) {
      // 「残り」表示かどうかを確認
      const isRemaining = raw.includes('残り') || raw.toLowerCase().includes('remaining')
      usagePercent = isRemaining ? 100 - Number(pct[1]) : Number(pct[1])
    }
  }

  // リセット日時
  if (!resetAt) {
    const resetMatch = raw.match(/リセット[：:]\s*(.+?)(?:\n|$)/)
      ?? raw.match(/resets?\s*[：:]?\s*(.+?)(?:\n|$)/i)
    if (resetMatch) {
      resetAt = resetMatch[1].trim()
    }
  }

  return { usageText, usagePercent, resetAt, raw }
}

// --- Alert Logic ---

const WAKE_HOUR_JST = 9
const SESSION_WINDOW_HOURS = 5

/**
 * 使用状況を分析してアラートを判定する。
 *
 * アラート条件:
 * 1. 週間ペース超過: (週間上限 ÷ 7 × 経過日数) を超えている
 * 2. Sonnet 週間ペース超過: 同上（Sonnet 専用）
 * 3. 5時間セッション制限中
 * 4. 起床時間 (09:00 JST) に5時間枠が回復しない見込み
 * 5. Codex ペース超過
 */
export function evaluateAlerts(report: UsageReport): UsageAlerts {
  const alerts: UsageAlerts = {
    weeklyPaceExceeded: false,
    sonnetPaceExceeded: false,
    sessionRateLimited: false,
    wakeTimeConflict: false,
    codexPaceExceeded: false,
    hasAlerts: false,
  }

  const claudeParsed = report.claude?.claude

  // --- Session alerts ---
  if (claudeParsed?.session) {
    const { rateLimited, remaining, usagePercent } = claudeParsed.session

    if (rateLimited || usagePercent >= 100) {
      alerts.sessionRateLimited = true
      alerts.sessionDetail = remaining
        ? `セッション制限中（回復まで ${remaining}）`
        : 'セッション制限中'
    }

    // Wake time conflict: 今から5時間以内に09:00 JST が来る場合、
    // セッション使用率が高いと起床時に制限がかかっている可能性
    const now = new Date()
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
    const jstHour = jstNow.getUTCHours()
    const jstMinute = jstNow.getUTCMinutes()
    const currentJstMinutes = jstHour * 60 + jstMinute
    const wakeJstMinutes = WAKE_HOUR_JST * 60
    const hoursUntilWake = ((wakeJstMinutes - currentJstMinutes + 24 * 60) % (24 * 60)) / 60

    if (hoursUntilWake <= SESSION_WINDOW_HOURS && hoursUntilWake > 0) {
      // 起床まで5時間以内。セッション使用率が高い or 制限中だと朝に困る
      if (rateLimited || usagePercent >= 80) {
        alerts.wakeTimeConflict = true
        alerts.wakeTimeDetail =
          `起床 (${WAKE_HOUR_JST}:00) まであと ${hoursUntilWake.toFixed(1)}h — ` +
          `セッション使用率 ${usagePercent}% で起床時に制限がかかる可能性`
      }
    }
  }

  // --- Weekly pace alerts ---
  if (claudeParsed?.weekly) {
    const { models, dayOfWeek } = claudeParsed.weekly
    const elapsed = (dayOfWeek ?? 0) + 1 // 経過日数（最低1日）

    for (const model of models) {
      if (model.usagePercent === undefined) continue

      // ペース計算: 使用率が (経過日数/7) の割合を超えていたらペース超過
      const expectedPercent = Math.round((elapsed / 7) * 100)

      if (model.usagePercent > expectedPercent) {
        const detail =
          `${model.model}: ${model.usagePercent}% 使用（${elapsed}日目、` +
          `ペース目安 ${expectedPercent}%）${model.usageText ? ` [${model.usageText}]` : ''}`

        if (model.model === 'Sonnet') {
          alerts.sonnetPaceExceeded = true
          alerts.sonnetPaceDetail = detail
        }

        // Opus またはモデル不明は汎用の週間ペース
        if (model.model === 'Opus' || model.model !== 'Sonnet') {
          alerts.weeklyPaceExceeded = true
          alerts.weeklyPaceDetail = detail
        }
      }
    }
  }

  // --- Codex alerts ---
  const codexParsed = report.codex?.codex
  if (codexParsed?.usagePercent !== undefined) {
    // Codex はデイリーリセット。50%超えたらペース注意
    if (codexParsed.usagePercent > 50) {
      alerts.codexPaceExceeded = true
      alerts.codexPaceDetail =
        `Codex: ${codexParsed.usagePercent}% 使用` +
        (codexParsed.usageText ? ` (${codexParsed.usageText})` : '')
    }
  }

  alerts.hasAlerts =
    alerts.weeklyPaceExceeded ||
    alerts.sonnetPaceExceeded ||
    alerts.sessionRateLimited ||
    alerts.wakeTimeConflict ||
    alerts.codexPaceExceeded

  return alerts
}

// --- Public API ---

export async function scrapeUsage(): Promise<UsageReport> {
  log.info('Starting usage scrape...')
  let context: BrowserContext | null = null

  try {
    context = await createBrowserContext()
    const page = context.pages()[0] ?? await context.newPage()

    const claude = await scrapeClaudeUsage(page)
    appendSnapshot(claude)

    if (claude.error) {
      log.warn(`Claude: ${claude.error}`)
    } else {
      log.info(`Claude session: ${claude.claude?.session?.usagePercent ?? '?'}%, weekly models: ${claude.claude?.weekly?.models.length ?? 0}`)
    }

    const codex = await scrapeCodexUsage(page)
    appendSnapshot(codex)

    if (codex.error) {
      log.warn(`Codex: ${codex.error}`)
    } else {
      log.info(`Codex: ${codex.codex?.usagePercent ?? '?'}%`)
    }

    return { claude, codex, scrapedAt: new Date().toISOString() }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`Usage scrape failed: ${message}`)
    return { claude: null, codex: null, scrapedAt: new Date().toISOString() }
  } finally {
    if (context) {
      await context.close().catch((err: unknown) => {
        log.warn(`Failed to close browser: ${(err as Error).message}`)
      })
    }
  }
}

export function getLatestUsage(): UsageReport {
  const snapshots = readAllSnapshots()

  let claude: UsageSnapshot | null = null
  let codex: UsageSnapshot | null = null

  for (let i = snapshots.length - 1; i >= 0; i--) {
    const s = snapshots[i]
    if (!claude && s.provider === 'claude') claude = s
    if (!codex && s.provider === 'codex') codex = s
    if (claude && codex) break
  }

  return {
    claude,
    codex,
    scrapedAt: claude?.timestamp ?? codex?.timestamp ?? new Date().toISOString(),
  }
}
