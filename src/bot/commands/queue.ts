import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js'
import { getAll } from '../../queue/processor.js'
import { COLORS, STATUS_EMOJI, createEmbed } from '../theme.js'

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

  const lines = items.slice(0, 20).map((item) => {
    const emoji = STATUS_EMOJI[item.status] ?? '\u2753'
    return `${emoji} Issue #${item.issueNumber} — ${item.priority} — ${item.status}`
  })

  const embed = createEmbed(COLORS.info, `キュー一覧 (${items.length}件)`, {
    description: lines.join('\n'),
    footer: items.length > 20 ? `他 ${items.length - 20}件` : undefined,
  })

  await interaction.reply({ embeds: [embed] })
}
