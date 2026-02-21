import { type Client, EmbedBuilder, type TextChannel } from 'discord.js'
import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('notifier')

let client: Client | null = null

export function initNotifier(discordClient: Client): void {
  client = discordClient
}

async function getChannel(): Promise<TextChannel | null> {
  if (!client) return null
  try {
    const channel = await client.channels.fetch(config.discord.channelId)
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
): Promise<void> {
  const channel = await getChannel()
  if (!channel) return

  const embed = new EmbedBuilder()
    .setColor(0x238636)
    .setTitle(`Issue #${issueNumber} を作成しました`)
    .setURL(url)
    .addFields(
      { name: 'タイトル', value: title },
      { name: 'ラベル', value: labels.length > 0 ? labels.join(', ') : 'なし' },
    )
    .setTimestamp()

  await channel.send({ embeds: [embed] })
  log.info(`Notified: Issue #${issueNumber} created`)
}

export async function notifyQueueStatus(
  stats: { pending: number; processing: number; completed: number; failed: number },
): Promise<void> {
  const channel = await getChannel()
  if (!channel) return

  const embed = new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle('キューステータス')
    .addFields(
      { name: '待機中', value: String(stats.pending), inline: true },
      { name: '処理中', value: String(stats.processing), inline: true },
      { name: '完了', value: String(stats.completed), inline: true },
      { name: '失敗', value: String(stats.failed), inline: true },
    )
    .setTimestamp()

  await channel.send({ embeds: [embed] })
}

export async function notifyProcessingStart(
  issueNumber: number,
): Promise<void> {
  const channel = await getChannel()
  if (!channel) return

  const embed = new EmbedBuilder()
    .setColor(0xd29922)
    .setTitle(`Issue #${issueNumber} の処理を開始しました`)
    .setTimestamp()

  await channel.send({ embeds: [embed] })
}

export async function notifyProcessingComplete(
  issueNumber: number,
  success: boolean,
  message?: string,
): Promise<void> {
  const channel = await getChannel()
  if (!channel) return

  const embed = new EmbedBuilder()
    .setColor(success ? 0x238636 : 0xda3633)
    .setTitle(
      success
        ? `Issue #${issueNumber} の処理が完了しました`
        : `Issue #${issueNumber} の処理に失敗しました`,
    )
    .setTimestamp()

  if (message) {
    embed.setDescription(message)
  }

  await channel.send({ embeds: [embed] })
}

export async function notifyError(errorMessage: string): Promise<void> {
  const channel = await getChannel()
  if (!channel) return

  const embed = new EmbedBuilder()
    .setColor(0xda3633)
    .setTitle('エラーが発生しました')
    .setDescription(errorMessage.slice(0, 4000))
    .setTimestamp()

  await channel.send({ embeds: [embed] })
}
