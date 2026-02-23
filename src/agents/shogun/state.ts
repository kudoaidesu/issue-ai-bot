/**
 * ショーグン状態スナップショット
 *
 * ショーグンエージェントが意図分類・委任判断を行うために必要な
 * システム全体の状態を一括取得する。
 *
 * GitHub情報は gh CLI 経由のため、ここには含めない（オンデマンドで取得）。
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../../config.js'
import { getAll, getStats } from '../../queue/processor.js'
import { isLocked } from '../../queue/rate-limiter.js'
import { getScheduledTasks } from '../../queue/scheduler.js'
import { getAuditLog } from '../../utils/audit.js'
import { getLatestUsage } from '../../utils/usage-monitor.js'
import { getAllSessions, getSessionsByGuild } from '../../session/index.js'
import { readMemory } from '../../memory/index.js'
import { readTodayAndYesterdayLogs } from '../../memory/store.js'
import type { QueueItem } from '../../queue/processor.js'
import type { SessionEntry } from '../../session/index.js'
import type { AuditEntry } from '../../utils/audit.js'

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export interface AlertStateFlags {
  sessionRateLimited: boolean
  wakeTimeConflict: boolean
  weeklyPaceExceeded: boolean
  sonnetPaceExceeded: boolean
  codexPaceExceeded: boolean
}

export interface ShogunSnapshot {
  /** スナップショット取得時刻 (ISO 8601) */
  timestamp: string

  /** キューとタスク実行状態 */
  queue: {
    stats: { pending: number; processing: number; completed: number; failed: number; total: number }
    /** 未処理のジョブ一覧 */
    pendingItems: QueueItem[]
    /** 現在実行中のジョブ（なければ null） */
    processingItem: QueueItem | null
    /** ロック中か（実行中タスクあり） */
    isLocked: boolean
  }

  /** 登録済みプロジェクト */
  projects: Array<{
    slug: string
    repo: string
    guildId: string
    channelId: string
    localPath: string
  }>

  /** Cronスケジュール（登録中のジョブ一覧） */
  cron: {
    tasks: Array<{ name: string; schedule: string }>
  }

  /** LLM使用量とアラート状態 */
  llmUsage: {
    claude: {
      sessionPercent: number | null
      remaining: string | null
      weeklyAllPercent: number | null
      weeklySonnetPercent: number | null
    } | null
    codex: {
      usagePercent: number | null
      resetAt: string | null
    } | null
    alerts: AlertStateFlags
    lastUpdated: string | null
  }

  /** アクティブなチャットセッション */
  activeSessions: SessionEntry[]

  /** 直近の操作履歴（最新20件） */
  recentAudit: AuditEntry[]

  /** メモリ（guildId 指定時のみ取得） */
  memory: {
    /** MEMORY.md の内容（永続的な知識・ルール） */
    permanentMemory: string
    /** 本日 + 昨日のデイリーログ */
    dailyLog: string
  } | null
}

// ---------------------------------------------------------------------------
// 内部ヘルパー
// ---------------------------------------------------------------------------

function loadAlertState(): AlertStateFlags {
  const alertPath = join(config.queue.dataDir, 'alert-state.json')
  const defaults: AlertStateFlags = {
    sessionRateLimited: false,
    wakeTimeConflict: false,
    weeklyPaceExceeded: false,
    sonnetPaceExceeded: false,
    codexPaceExceeded: false,
  }
  if (!existsSync(alertPath)) return defaults
  try {
    const parsed = JSON.parse(readFileSync(alertPath, 'utf-8')) as Record<string, unknown>
    return {
      sessionRateLimited: Boolean(parsed.sessionRateLimited),
      wakeTimeConflict: Boolean(parsed.wakeTimeConflict),
      weeklyPaceExceeded: Boolean(parsed.weeklyPaceExceeded),
      sonnetPaceExceeded: Boolean(parsed.sonnetPaceExceeded),
      codexPaceExceeded: Boolean(parsed.codexPaceExceeded),
    }
  } catch {
    return defaults
  }
}

// ---------------------------------------------------------------------------
// メイン関数
// ---------------------------------------------------------------------------

/**
 * ショーグン用システムスナップショットを取得する。
 *
 * @param guildId - Discord ギルドID。指定するとメモリ・セッションをそのギルドに絞る。
 */
export function getShogunSnapshot(guildId?: string): ShogunSnapshot {
  // ── キュー ──────────────────────────────────────────────
  const stats = getStats()
  const allItems = getAll()
  const processingItem = allItems.find((i) => i.status === 'processing') ?? null
  const pendingItems = allItems.filter((i) => i.status === 'pending')

  // ── Cron ────────────────────────────────────────────────
  const cronTasks = getScheduledTasks()

  // ── LLM使用量 ────────────────────────────────────────────
  let llmUsage: ShogunSnapshot['llmUsage']
  try {
    const report = getLatestUsage()
    const alerts = loadAlertState()
    // report.claude / report.codex は UsageSnapshot 型
    // UsageSnapshot.claude は ClaudeParsed 型
    const claudeParsed = report.claude?.claude
    const codexParsed = report.codex?.codex
    llmUsage = {
      claude: claudeParsed
        ? {
            sessionPercent: claudeParsed.session?.usagePercent ?? null,
            remaining: claudeParsed.session?.remaining ?? null,
            weeklyAllPercent:
              claudeParsed.weekly?.models.find((m) => m.model === 'All')?.usagePercent ?? null,
            weeklySonnetPercent:
              claudeParsed.weekly?.models.find((m) => m.model === 'Sonnet')?.usagePercent ?? null,
          }
        : null,
      codex: codexParsed
        ? {
            usagePercent: codexParsed.usagePercent ?? null,
            resetAt: codexParsed.resetAt ?? null,
          }
        : null,
      alerts,
      lastUpdated: report.claude?.timestamp ?? report.codex?.timestamp ?? null,
    }
  } catch {
    llmUsage = {
      claude: null,
      codex: null,
      alerts: loadAlertState(),
      lastUpdated: null,
    }
  }

  // ── セッション ───────────────────────────────────────────
  const rawSessions = guildId ? getSessionsByGuild(guildId) : getAllSessions()
  const activeSessions = rawSessions.filter((s) => s.status === 'active')

  // ── 監査ログ ─────────────────────────────────────────────
  const recentAudit = getAuditLog(20)

  // ── メモリ（guildId 指定時のみ） ──────────────────────────
  let memory: ShogunSnapshot['memory'] = null
  if (guildId) {
    try {
      memory = {
        permanentMemory: readMemory(guildId),
        dailyLog: readTodayAndYesterdayLogs(guildId),
      }
    } catch {
      memory = null
    }
  }

  return {
    timestamp: new Date().toISOString(),
    queue: {
      stats,
      pendingItems,
      processingItem,
      isLocked: isLocked(),
    },
    projects: config.projects.map((p) => ({
      slug: p.slug,
      repo: p.repo,
      guildId: p.guildId,
      channelId: p.channelId,
      localPath: p.localPath,
    })),
    cron: { tasks: cronTasks },
    llmUsage,
    activeSessions,
    recentAudit,
    memory,
  }
}

// ---------------------------------------------------------------------------
// プロンプト埋め込み用フォーマッター
// ---------------------------------------------------------------------------

/**
 * スナップショットをショーグンのシステムプロンプトに埋め込みやすい
 * 日本語テキスト形式に変換する。
 */
export function formatSnapshotForPrompt(snapshot: ShogunSnapshot): string {
  const lines: string[] = []
  const ts = new Date(snapshot.timestamp).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  lines.push(`## システム状態 (${ts})`)
  lines.push('')

  // ── キュー ──
  const q = snapshot.queue
  lines.push('### キュー')
  lines.push(
    `- 待機: ${q.stats.pending}件 | 実行中: ${q.stats.processing}件 | 完了: ${q.stats.completed}件 | 失敗: ${q.stats.failed}件`,
  )
  lines.push(`- ロック: ${q.isLocked ? '🔒 実行中（新規タスク受付不可）' : '🔓 空き'}`)
  if (q.processingItem) {
    lines.push(
      `- 🚀 実行中: Issue #${q.processingItem.issueNumber} (${q.processingItem.repository}) [${q.processingItem.priority}]`,
    )
  }
  if (q.pendingItems.length > 0) {
    lines.push('- 待機キュー:')
    for (const item of q.pendingItems.slice(0, 5)) {
      lines.push(`  - Issue #${item.issueNumber} [${item.priority}] — ${item.repository}`)
    }
    if (q.pendingItems.length > 5) {
      lines.push(`  - … 他 ${q.pendingItems.length - 5} 件`)
    }
  }
  lines.push('')

  // ── Cron ──
  lines.push('### Cronスケジュール')
  for (const task of snapshot.cron.tasks) {
    lines.push(`- ${task.name}: \`${task.schedule}\``)
  }
  lines.push('')

  // ── LLM使用量 ──
  const u = snapshot.llmUsage
  lines.push('### LLM使用量')
  if (u.claude) {
    lines.push(
      `- Claude: セッション ${u.claude.sessionPercent ?? '?'}% 使用 (残り ${u.claude.remaining ?? '?'})`,
    )
    lines.push(
      `  週間: 全体 ${u.claude.weeklyAllPercent ?? '?'}% / Sonnet ${u.claude.weeklySonnetPercent ?? '?'}%`,
    )
  } else {
    lines.push('- Claude: データなし')
  }
  if (u.codex) {
    lines.push(
      `- Codex: ${u.codex.usagePercent ?? '?'}% 使用 (リセット: ${u.codex.resetAt ?? '?'})`,
    )
  }
  if (u.lastUpdated) {
    const updAt = new Date(u.lastUpdated).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' })
    lines.push(`- 最終更新: ${updAt}`)
  }
  const activeAlerts = Object.entries(u.alerts)
    .filter(([, v]) => v)
    .map(([k]) => k)
  if (activeAlerts.length > 0) {
    lines.push(`- ⚠️ アラート: ${activeAlerts.join(', ')}`)
  }
  lines.push('')

  // ── プロジェクト ──
  lines.push('### 登録プロジェクト')
  for (const p of snapshot.projects) {
    lines.push(`- ${p.slug}: ${p.repo} (${p.localPath})`)
  }
  lines.push('')

  // ── アクティブセッション ──
  if (snapshot.activeSessions.length > 0) {
    lines.push('### アクティブセッション')
    for (const s of snapshot.activeSessions) {
      const last = new Date(s.lastActiveAt).toLocaleTimeString('ja-JP', {
        timeZone: 'Asia/Tokyo',
      })
      lines.push(
        `- ch=${s.channelId} model=${s.model} msgs=${s.messageCount} 最終:${last} "${s.summary.slice(0, 50)}"`,
      )
    }
    lines.push('')
  }

  // ── 永続メモリ ──
  if (snapshot.memory?.permanentMemory) {
    lines.push('### 永続メモリ (MEMORY.md)')
    const mem = snapshot.memory.permanentMemory
    lines.push(mem.length > 600 ? `${mem.slice(0, 600)}\n…(省略)` : mem)
    lines.push('')
  }

  // ── デイリーログ ──
  if (snapshot.memory?.dailyLog) {
    lines.push('### 本日・昨日のログ')
    const log = snapshot.memory.dailyLog
    lines.push(log.length > 400 ? `${log.slice(0, 400)}\n…(省略)` : log)
    lines.push('')
  }

  // ── 直近の操作履歴 ──
  if (snapshot.recentAudit.length > 0) {
    lines.push('### 直近の操作履歴 (最新5件)')
    for (const entry of snapshot.recentAudit.slice(-5)) {
      const t = new Date(entry.timestamp).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' })
      lines.push(`- [${t}] ${entry.action} → ${entry.result} (${entry.actor})`)
    }
  }

  return lines.join('\n')
}
