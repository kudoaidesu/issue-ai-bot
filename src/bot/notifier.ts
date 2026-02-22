import { type Client, type TextChannel } from 'discord.js'
import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'
import { COLORS, createEmbed } from './theme.js'

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

  await channel.send({ embeds: [embed] })
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
