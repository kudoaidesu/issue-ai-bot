import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
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

  return chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: 'chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
    timeout: config.usageMonitor.timeoutMs,
  })
}

// --- Scraping ---

async function scrapeClaudeUsage(page: Page): Promise<UsageSnapshot> {
  const timestamp = new Date().toISOString()
  try {
    await page.goto(config.usageMonitor.claudeUsageUrl, {
      waitUntil: 'networkidle',
      timeout: config.usageMonitor.timeoutMs,
    })

    if (page.url().includes('/login')) {
      return {
        timestamp,
        provider: 'claude',
        raw: '',
        error: '認証切れ — npm run setup:usage で再ログインしてください',
      }
    }

    await page.waitForTimeout(3000)

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
      waitUntil: 'networkidle',
      timeout: config.usageMonitor.timeoutMs,
    })

    if (page.url().includes('/auth/login') || page.url().includes('/login')) {
      return {
        timestamp,
        provider: 'codex',
        raw: '',
        error: '認証切れ — npm run setup:usage で再ログインしてください',
      }
    }

    await page.waitForTimeout(3000)

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

function parseClaudeUsage(raw: string): ClaudeParsed {
  let session: SessionLimit | null = null
  let weekly: WeeklyLimit | null = null

  const lowerRaw = raw.toLowerCase()

  // --- Session parsing ---
  // Look for "current session" section, rate-limited indicators, remaining time
  const rateLimited =
    lowerRaw.includes('rate limit') ||
    lowerRaw.includes('limit reached') ||
    lowerRaw.includes('usage limit') ||
    lowerRaw.includes('you\'ve hit')

  // Match remaining time like "4h 32m remaining" or "2 hours remaining"
  const remainingMatch = raw.match(
    /(\d+h?\s*\d*m?\s*(?:hour|minute|min|hr|h|m)?\w*)\s*remaining/i,
  )
  const remaining = remainingMatch ? remainingMatch[1].trim() : undefined

  // Match session percentage
  const sessionPercentMatch = raw.match(
    /(?:current\s+session|session\s+limit)[^]*?(\d{1,3})\s*%/i,
  )
  const sessionPercent = sessionPercentMatch
    ? Number(sessionPercentMatch[1])
    : rateLimited
      ? 100
      : undefined

  if (sessionPercent !== undefined || rateLimited || remaining) {
    session = {
      usagePercent: sessionPercent ?? (rateLimited ? 100 : 0),
      remaining,
      rateLimited,
    }
  }

  // --- Weekly parsing ---
  // Match reset info like "resets on Monday" or "resets Feb 24"
  const resetMatch = raw.match(/resets?\s+(?:on\s+)?(.+?)(?:\.|$|\n)/i)
  const resetAt = resetMatch ? resetMatch[1].trim() : undefined

  // Match model-specific usage: "Sonnet 4: 12h of 140-280h" or "Opus 4: 5h of 15-35h"
  const models: WeeklyModelUsage[] = []

  const modelPatterns = [
    /(?:claude\s+)?(?:sonnet|claude\s*4\.5\s*sonnet|sonnet\s*4)[^]*?(\d+\.?\d*h?\s*(?:of|\/)\s*[\d\-–]+h?)/gi,
    /(?:claude\s+)?(?:opus|claude\s*4\s*opus|opus\s*4)[^]*?(\d+\.?\d*h?\s*(?:of|\/)\s*[\d\-–]+h?)/gi,
  ]

  for (const pattern of modelPatterns) {
    const match = pattern.exec(raw)
    if (match) {
      const modelName = pattern.source.includes('sonnet') ? 'Sonnet' : 'Opus'
      const usageText = match[1]

      // Try to extract percentage from usage text like "12h of 140h" → 12/140 = 8.6%
      const numbersMatch = usageText.match(/(\d+\.?\d*)\s*h?\s*(?:of|\/)\s*(\d+)/i)
      let usagePercent: number | undefined
      if (numbersMatch) {
        const used = Number(numbersMatch[1])
        const total = Number(numbersMatch[2])
        if (total > 0) {
          usagePercent = Math.round((used / total) * 100)
        }
      }

      models.push({ model: modelName, usageText, usagePercent })
    }
  }

  // Also try generic percentage matches for models
  const allPercentMatches = [...raw.matchAll(/(\d{1,3})\s*%/g)]
  // Skip session percent, look for others
  for (const m of allPercentMatches) {
    const idx = m.index ?? 0
    const context = raw.slice(Math.max(0, idx - 60), idx + 20).toLowerCase()
    if (context.includes('sonnet') && !models.some((mo) => mo.model === 'Sonnet')) {
      models.push({ model: 'Sonnet', usagePercent: Number(m[1]) })
    }
    if (context.includes('opus') && !models.some((mo) => mo.model === 'Opus')) {
      models.push({ model: 'Opus', usagePercent: Number(m[1]) })
    }
  }

  // Determine day of week from reset info
  let dayOfWeek: number | undefined
  if (resetAt) {
    const daysMap: Record<string, number> = {
      monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
      friday: 4, saturday: 5, sunday: 6,
    }
    const dayMatch = resetAt.toLowerCase().match(
      /monday|tuesday|wednesday|thursday|friday|saturday|sunday/,
    )
    if (dayMatch) {
      const resetDay = daysMap[dayMatch[0]]
      const now = new Date()
      const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
      const currentDay = jstNow.getUTCDay() // 0=Sun
      // Convert to days since reset
      // If reset is Monday (1), and today is Wednesday (3), dayOfWeek = 2
      const resetDayNum = (resetDay + 1) % 7 // Convert our 0=Mon to JS 0=Sun
      dayOfWeek = (currentDay - resetDayNum + 7) % 7
    }
  }

  if (resetAt || models.length > 0) {
    weekly = { resetAt, models, dayOfWeek }
  }

  return { session, weekly, raw }
}

function parseCodexUsage(raw: string): CodexParsed {
  // Match patterns like "12 of 50 tasks" or "12/50"
  const taskMatch = raw.match(/(\d+)\s*(?:of|\/)\s*(\d+)\s*(?:task|message)/i)
  let usageText: string | undefined
  let usagePercent: number | undefined

  if (taskMatch) {
    usageText = `${taskMatch[1]} / ${taskMatch[2]}`
    const used = Number(taskMatch[1])
    const total = Number(taskMatch[2])
    if (total > 0) {
      usagePercent = Math.round((used / total) * 100)
    }
  }

  // Fallback: generic percentage
  if (usagePercent === undefined) {
    const percentMatch = raw.match(/(\d{1,3})\s*%/)
    usagePercent = percentMatch ? Number(percentMatch[1]) : undefined
  }

  const resetMatch = raw.match(/resets?\s+(?:on\s+|at\s+)?(.+?)(?:\.|$|\n)/i)
  const resetAt = resetMatch ? resetMatch[1].trim() : undefined

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
