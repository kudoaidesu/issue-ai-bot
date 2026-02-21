import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js'
import { getAll } from '../../queue/processor.js'

export const data = new SlashCommandBuilder()
  .setName('queue')
  .setDescription('現在のキュー一覧を表示')

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const items = getAll()

  if (items.length === 0) {
    await interaction.reply('キューは空です。')
    return
  }

  const statusEmoji: Record<string, string> = {
    pending: '⏳',
    processing: '🔄',
    completed: '✅',
    failed: '❌',
  }

  const lines = items.slice(0, 20).map((item) => {
    const emoji = statusEmoji[item.status] ?? '❓'
    return `${emoji} Issue #${item.issueNumber} — ${item.priority} — ${item.status}`
  })

  const embed = new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle(`キュー一覧 (${items.length}件)`)
    .setDescription(lines.join('\n'))
    .setTimestamp()

  if (items.length > 20) {
    embed.setFooter({ text: `他 ${items.length - 20}件` })
  }

  await interaction.reply({ embeds: [embed] })
}
