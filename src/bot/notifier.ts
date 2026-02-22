import { type Client, type TextChannel, type Message, type ThreadChannel, ChannelType } from 'discord.js'
import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'
import { COLORS, createEmbed, createQueueButtons, createPrButtons } from './theme.js'
import type { ProgressData, ProgressStage } from '../agents/coder/types.js'
import type { CostReport } from '../utils/cost-tracker.js'

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
  if (data.costUsd !== undefined) {
    fields.push({ name: 'コスト', value: `$${data.costUsd.toFixed(2)}`, inline: true })
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
      reason: `AI Coder Agent processing Issue #${issueNumber}`,
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

// --- コストレポート + アラート ---

export async function notifyCostReport(
  costReport: CostReport,
  queueStats: { pending: number; completed: number; failed: number },
  channelId?: string,
): Promise<void> {
  const channel = await getChannel(channelId)
  if (!channel) return

  const repoBreakdown = costReport.byRepository
    .map((r) => `  ${r.repository}: $${r.costUsd.toFixed(2)}`)
    .join('\n')

  const color = costReport.dailyBudgetUsedPercent >= 80 ? COLORS.warning : COLORS.info

  const embed = createEmbed(color, 'デイリーレポート', {
    fields: [
      { name: '本日のコスト', value: `$${costReport.today.toFixed(2)}`, inline: true },
      { name: '今週のコスト', value: `$${costReport.thisWeek.toFixed(2)}`, inline: true },
      { name: '今月のコスト', value: `$${costReport.thisMonth.toFixed(2)}`, inline: true },
      { name: '日次予算使用率', value: `${costReport.dailyBudgetUsedPercent.toFixed(0)}%`, inline: true },
      { name: 'プロジェクト別', value: repoBreakdown || 'なし' },
      { name: 'キュー状況', value: `待機: ${queueStats.pending} / 完了: ${queueStats.completed} / 失敗: ${queueStats.failed}` },
    ],
  })

  await channel.send({ embeds: [embed] })
  log.info('Daily cost report sent to Discord')
}

export async function notifyCostAlert(
  currentCost: number,
  budgetLimit: number,
  channelId?: string,
): Promise<void> {
  const channel = await getChannel(channelId)
  if (!channel) return

  const embed = createEmbed(COLORS.error, 'コスト警告: 日次予算超過', {
    description: `本日のコスト ($${currentCost.toFixed(2)}) が日次予算 ($${budgetLimit.toFixed(2)}) を超過しました。キュー処理を停止しています。`,
  })

  await channel.send({ embeds: [embed] })
  log.warn(`Cost alert: $${currentCost.toFixed(2)} exceeds budget $${budgetLimit.toFixed(2)}`)
}
