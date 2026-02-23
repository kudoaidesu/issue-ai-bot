import { type Client, type TextChannel, type Message, type ThreadChannel, ChannelType } from 'discord.js'
import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'
import { COLORS, createEmbed, createQueueButtons, createPrButtons } from './theme.js'
import type { ProgressData, ProgressStage } from '../agents/taicho/types.js'
import type { UsageReport, UsageSnapshot, UsageAlerts } from '../utils/usage-monitor.js'

const log = createLogger('notifier')

let client: Client | null = null

export function initNotifier(discordClient: Client): void {
  client = discordClient
}

async function getChannel(channelId?: string): Promise<TextChannel | null> {
  if (!client) return null
  // channelId が指定されなかった場合、最初のプロジェクトの channelId をフォールバック
  const id = channelId ?? config.projects[0]?.channelId
  if (!id) return null
  try {
    const channel = await client.channels.fetch(id)
    if (channel?.isTextBased()) {
      return channel as TextChannel
    }
  } catch (err) {
    log.error('Failed to fetch notification channel', err)
  }
  return null
}

export async function notifyIssueCreated(
  issueNumber: number,
  title: string,
  url: string,
  labels: string[],
  channelId?: string,
  queueItemId?: string,
): Promise<void> {
  const channel = await getChannel(channelId)
  if (!channel) return

  const embed = createEmbed(COLORS.success, `Issue #${issueNumber} を作成しました`, {
    url,
    fields: [
      { name: 'タイトル', value: title },
      { name: 'ラベル', value: labels.length > 0 ? labels.join(', ') : 'なし' },
    ],
  })

  const options: Parameters<typeof channel.send>[0] = { embeds: [embed] }
  if (queueItemId) {
    options.components = [createQueueButtons(queueItemId)]
  }

  await channel.send(options)
  log.info(`Notified: Issue #${issueNumber} created`)
}

export async function notifyImmediateStart(
  issueNumber: number,
  title: string,
  url: string,
  labels: string[],
  channelId?: string,
): Promise<void> {
  const channel = await getChannel(channelId)
  if (!channel) return

  const embed = createEmbed(COLORS.warning, `Issue #${issueNumber} の即時処理を開始します`, {
    url,
    fields: [
      { name: 'タイトル', value: title },
      { name: 'ラベル', value: labels.length > 0 ? labels.join(', ') : 'なし' },
      { name: 'モード', value: '即時処理 (キューをスキップ)' },
    ],
  })

  await channel.send({ embeds: [embed] })
  log.info(`Notified: Issue #${issueNumber} immediate processing started`)
}

export async function notifyQueueStatus(
  stats: { pending: number; processing: number; completed: number; failed: number },
  channelId?: string,
): Promise<void> {
  const channel = await getChannel(channelId)
  if (!channel) return

  const embed = createEmbed(COLORS.info, 'キューステータス', {
    fields: [
      { name: '待機中', value: String(stats.pending), inline: true },
      { name: '処理中', value: String(stats.processing), inline: true },
      { name: '完了', value: String(stats.completed), inline: true },
      { name: '失敗', value: String(stats.failed), inline: true },
    ],
  })

  await channel.send({ embeds: [embed] })
}

export async function notifyProcessingStart(
  issueNumber: number,
  channelId?: string,
): Promise<void> {
  const channel = await getChannel(channelId)
  if (!channel) return

  const embed = createEmbed(COLORS.warning, `Issue #${issueNumber} の処理を開始しました`)

  await channel.send({ embeds: [embed] })
}

export async function notifyProcessingComplete(
  issueNumber: number,
  success: boolean,
  message?: string,
  channelId?: string,
): Promise<void> {
  const channel = await getChannel(channelId)
  if (!channel) return

  const color = success ? COLORS.success : COLORS.error
  const title = success
    ? `Issue #${issueNumber} の処理が完了しました`
    : `Issue #${issueNumber} の処理に失敗しました`

  const embed = createEmbed(color, title, {
    description: message,
  })

  await channel.send({ embeds: [embed] })
}

export async function notifyError(errorMessage: string, channelId?: string): Promise<void> {
  const channel = await getChannel(channelId)
  if (!channel) return

  const embed = createEmbed(COLORS.error, 'エラーが発生しました', {
    description: errorMessage.slice(0, 4000),
  })

  await channel.send({ embeds: [embed] })
}

// --- 使用量レポート ---

function formatClaudeSnapshot(snapshot: UsageSnapshot | null): string {
  if (!snapshot) return 'データなし'
  if (snapshot.error) return `**エラー**: ${snapshot.error.slice(0, 200)}`

  const claude = snapshot.claude
  if (!claude) return snapshot.raw.slice(0, 300) || 'データ取得できませんでした'

  const parts: string[] = []

  // Session
  if (claude.session) {
    const s = claude.session
    const status = s.rateLimited ? '**制限中**' : `${s.usagePercent}%`
    parts.push(`セッション: ${status}${s.remaining ? ` (残り ${s.remaining})` : ''}`)
  }

  // Weekly models
  if (claude.weekly) {
    for (const m of claude.weekly.models) {
      const pct = m.usagePercent !== undefined ? `${m.usagePercent}%` : '?%'
      parts.push(`${m.model}: ${pct}${m.usageText ? ` [${m.usageText}]` : ''}`)
    }
    if (claude.weekly.resetAt) {
      parts.push(`リセット: ${claude.weekly.resetAt}`)
    }
    if (claude.weekly.dayOfWeek !== undefined) {
      parts.push(`週の ${claude.weekly.dayOfWeek + 1} 日目`)
    }
  }

  return parts.length > 0 ? parts.join('\n').slice(0, 1024) : 'パース失敗'
}

function formatCodexSnapshot(snapshot: UsageSnapshot | null): string {
  if (!snapshot) return 'データなし'
  if (snapshot.error) return `**エラー**: ${snapshot.error.slice(0, 200)}`

  const codex = snapshot.codex
  if (!codex) return snapshot.raw.slice(0, 300) || 'データ取得できませんでした'

  const parts: string[] = []
  if (codex.usagePercent !== undefined) {
    parts.push(`使用率: **${codex.usagePercent}%**`)
  }
  if (codex.usageText) {
    parts.push(`タスク: ${codex.usageText}`)
  }
  if (codex.resetAt) {
    parts.push(`リセット: ${codex.resetAt}`)
  }

  return parts.length > 0 ? parts.join('\n').slice(0, 1024) : 'パース失敗'
}

export async function notifyUsageReport(
  report: UsageReport,
  channelId?: string,
): Promise<void> {
  const channel = await getChannel(channelId)
  if (!channel) return

  const fields: Array<{ name: string; value: string; inline?: boolean }> = []

  fields.push({
    name: 'Claude (Max)',
    value: formatClaudeSnapshot(report.claude),
    inline: false,
  })

  fields.push({
    name: 'OpenAI Codex',
    value: formatCodexSnapshot(report.codex),
    inline: false,
  })

  const hasErrors = report.claude?.error ?? report.codex?.error
  const color = hasErrors ? COLORS.error : COLORS.info

  const embed = createEmbed(color, 'LLM 使用量レポート（日次）', {
    fields,
    footer: `取得時刻: ${new Date(report.scrapedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
  })

  await channel.send({ embeds: [embed] })
  log.info('Daily usage report sent to Discord')
}

export async function notifyUsageAlert(
  alerts: UsageAlerts,
  report: UsageReport,
  channelId?: string,
): Promise<void> {
  if (!alerts.hasAlerts) return

  const channel = await getChannel(channelId)
  if (!channel) return

  const fields: Array<{ name: string; value: string; inline?: boolean }> = []

  if (alerts.sessionRateLimited) {
    fields.push({ name: '5h セッション制限', value: alerts.sessionDetail ?? '制限中' })
  }
  if (alerts.wakeTimeConflict) {
    fields.push({ name: '起床時間衝突', value: alerts.wakeTimeDetail ?? '起床時に制限がかかる可能性' })
  }
  if (alerts.weeklyPaceExceeded) {
    fields.push({ name: 'Opus ペース超過', value: alerts.weeklyPaceDetail ?? 'ペース超過' })
  }
  if (alerts.sonnetPaceExceeded) {
    fields.push({ name: 'Sonnet ペース超過', value: alerts.sonnetPaceDetail ?? 'ペース超過' })
  }
  if (alerts.codexPaceExceeded) {
    fields.push({ name: 'Codex ペース超過', value: alerts.codexPaceDetail ?? 'ペース超過' })
  }

  if (fields.length === 0) return

  const embed = createEmbed(COLORS.warning, 'LLM 使用量アラート', {
    fields,
    footer: `取得時刻: ${new Date(report.scrapedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
  })

  await channel.send({ embeds: [embed] })
  log.warn(`Usage alert sent: ${fields.map((f) => f.name).join(', ')}`)
}

export async function notifyDailyUsageStatus(
  report: UsageReport,
  alertChannelId?: string,
  queueStats?: { pending: number; processing: number; completed: number; failed: number; total: number },
): Promise<void> {
  const channel = await getChannel(alertChannelId)
  if (!channel) return

  const fields: Array<{ name: string; value: string; inline?: boolean }> = []
  const alertParts: string[] = []

  // Claude の状況
  if (report.claude?.claude) {
    const c = report.claude.claude
    const statusParts: string[] = []

    // セッション情報
    if (c.session) {
      const sessionStatus = c.session.rateLimited
        ? '🔴 制限中'
        : `${c.session.usagePercent}% 使用中`
      statusParts.push(`セッション: ${sessionStatus}${c.session.remaining ? ` (${c.session.remaining})` : ''}`)
    }

    // 週間モデル別使用量
    if (c.weekly?.models && c.weekly.models.length > 0) {
      for (const m of c.weekly.models) {
        const pct = m.usagePercent !== undefined ? `${m.usagePercent}%` : '?%'
        let detail = `${m.model}: ${pct} 使用`

        // 日数とペース目安を表示
        if (c.weekly.dayOfWeek !== undefined && m.usagePercent !== undefined) {
          const dayOfWeek = c.weekly.dayOfWeek + 1
          const expectedPercent = Math.round((dayOfWeek / 7) * 100)
          detail += `（${dayOfWeek}日目、ペース目安 ${expectedPercent}%）`

          // ペース超過判定
          if (m.usagePercent > expectedPercent) {
            alertParts.push(`⚠️ ${m.model} ペース超過`)
          }
        }

        if (m.usageText) {
          detail += ` [${m.usageText}]`
        }
        statusParts.push(detail)
      }

      // リセット日時
      if (c.weekly.resetAt) {
        statusParts.push(`リセット: ${c.weekly.resetAt}`)
      }
      if (c.weekly.dayOfWeek !== undefined) {
        statusParts.push(`週の ${c.weekly.dayOfWeek + 1} 日目`)
      }
    }

    fields.push({
      name: 'Claude Max',
      value: statusParts.length > 0 ? statusParts.join('\n') : 'データなし',
      inline: false,
    })
  } else if (report.claude?.error) {
    fields.push({
      name: 'Claude Max',
      value: `⚠️ ${report.claude.error}`,
      inline: false,
    })
  } else {
    fields.push({
      name: 'Claude Max',
      value: 'データ取得失敗',
      inline: false,
    })
  }

  // Codex の状況
  if (report.codex?.codex) {
    const cx = report.codex.codex
    const codexParts: string[] = []

    let codexDetail = `使用率: ${cx.usagePercent ?? '?'}%`
    if (cx.usagePercent !== undefined) {
      const remaining = 100 - cx.usagePercent
      codexDetail += ` (残り ${remaining}%)`
    }
    codexParts.push(codexDetail)

    if (cx.usageText) {
      codexParts.push(`タスク: ${cx.usageText}`)
    }
    if (cx.resetAt) {
      codexParts.push(`リセット: ${cx.resetAt}`)
    }

    // ペース超過判定
    if (cx.usagePercent !== undefined && cx.usagePercent >= 50) {
      alertParts.push('⚠️ Codex ペース超過')
    }

    fields.push({
      name: 'OpenAI Codex',
      value: codexParts.join('\n'),
      inline: false,
    })
  } else if (report.codex?.error) {
    fields.push({
      name: 'OpenAI Codex',
      value: `⚠️ ${report.codex.error}`,
      inline: false,
    })
  } else {
    fields.push({
      name: 'OpenAI Codex',
      value: 'データ取得失敗',
      inline: false,
    })
  }

  // キュー状況
  if (queueStats) {
    const queueLines = [
      `待機中: ${queueStats.pending}　処理中: ${queueStats.processing}`,
      `完了: ${queueStats.completed}　失敗: ${queueStats.failed}　合計: ${queueStats.total}`,
    ]
    fields.push({
      name: 'キュー状況',
      value: queueLines.join('\n'),
      inline: false,
    })
  }

  const hasAlerts = alertParts.length > 0
  const description = hasAlerts ? alertParts.join('\n') : undefined
  const color = hasAlerts ? COLORS.warning : COLORS.info
  const title = hasAlerts ? 'LLM 使用量レポート（日次）⚠️ 超過あり' : 'LLM 使用量レポート（日次）'
  const embed = createEmbed(color, title, {
    description,
    fields,
    footer: `取得時刻: ${new Date(report.scrapedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
  })

  await channel.send({ embeds: [embed] })
  log.info('Daily usage status sent to Discord')
}

// --- Thread 管理 + リアルタイム進捗 ---

export interface IssueThreadContext {
  thread: ThreadChannel
  statusMessage: Message
}

const STAGE_CONFIG: Record<ProgressStage, { emoji: string; color: number; label: string }> = {
  setup:     { emoji: '🔧', color: COLORS.info,    label: 'Git セットアップ中' },
  coding:    { emoji: '🤖', color: COLORS.warning,  label: 'AI コーディング中' },
  verifying: { emoji: '🔍', color: COLORS.info,    label: 'コミット確認中' },
  pushing:   { emoji: '🚀', color: COLORS.info,    label: 'PR 作成中' },
  retrying:  { emoji: '🔄', color: COLORS.warning,  label: 'リトライ中' },
  done:      { emoji: '✅', color: COLORS.success,  label: '完了' },
  failed:    { emoji: '❌', color: COLORS.error,    label: '失敗' },
}

const MILESTONE_STAGES: Set<ProgressStage> = new Set(['coding', 'retrying', 'done', 'failed'])

function createProgressEmbed(data: ProgressData) {
  const cfg = STAGE_CONFIG[data.stage]
  const title = data.attempt && data.maxAttempts
    ? `${cfg.emoji} ${cfg.label} (${data.attempt}/${data.maxAttempts})`
    : `${cfg.emoji} ${cfg.label}`

  const fields: Array<{ name: string; value: string; inline?: boolean }> = []

  if (data.prUrl) {
    fields.push({ name: 'PR', value: data.prUrl })
  }
  if (data.durationMs !== undefined) {
    fields.push({ name: '所要時間', value: `${Math.round(data.durationMs / 1000)}秒`, inline: true })
  }
  if (data.error) {
    fields.push({ name: 'エラー', value: data.error.slice(0, 1024) })
  }

  return createEmbed(cfg.color, title, {
    description: data.message,
    fields: fields.length > 0 ? fields : undefined,
  })
}

function createMilestoneText(data: ProgressData): string {
  const cfg = STAGE_CONFIG[data.stage]
  const attemptStr = data.attempt && data.maxAttempts
    ? ` (${data.attempt}/${data.maxAttempts})`
    : ''
  return `${cfg.emoji} ${data.message}${attemptStr}`
}

export async function createIssueThread(
  issueNumber: number,
  issueTitle: string,
  channelId: string,
): Promise<IssueThreadContext | null> {
  const channel = await getChannel(channelId)
  if (!channel) return null

  try {
    const thread = await channel.threads.create({
      name: `Issue #${issueNumber}: ${issueTitle.slice(0, 80)}`,
      type: ChannelType.PublicThread,
      reason: `タイチョーが Issue #${issueNumber} を処理中`,
    })

    const embed = createEmbed(COLORS.info, `🤖 Issue #${issueNumber} の処理を開始します`, {
      description: issueTitle,
    })

    const statusMessage = await thread.send({ embeds: [embed] })

    log.info(`Created thread for Issue #${issueNumber}: ${thread.id}`)

    return { thread, statusMessage }
  } catch (err) {
    log.error('Failed to create issue thread', err)
    return null
  }
}

export async function updateProgress(
  ctx: IssueThreadContext,
  data: ProgressData,
): Promise<void> {
  try {
    const editOptions: Parameters<typeof ctx.statusMessage.edit>[0] = {
      embeds: [createProgressEmbed(data)],
    }

    // PR 完了時にマージボタンを付与
    if (data.stage === 'done' && data.prUrl) {
      editOptions.components = [createPrButtons(data.prUrl)]
    }

    await ctx.statusMessage.edit(editOptions)
  } catch (err) {
    log.warn(`Failed to edit status embed: ${(err as Error).message}`)
  }

  if (MILESTONE_STAGES.has(data.stage)) {
    try {
      await ctx.thread.send(createMilestoneText(data))
    } catch (err) {
      log.warn(`Failed to send milestone: ${(err as Error).message}`)
    }
  }
}

