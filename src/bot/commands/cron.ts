import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js'
import { getScheduledTasks } from '../../queue/scheduler.js'
import { COLORS, createEmbed } from '../theme.js'

export const data = new SlashCommandBuilder()
  .setName('cron')
  .setDescription('Cronジョブの状態を確認')

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const tasks = getScheduledTasks()

  const embed = createEmbed(COLORS.info, 'Cronジョブ一覧', {
    description: tasks
      .map((t) => `**${t.name}** — \`${t.schedule}\``)
      .join('\n'),
    fields: [{ name: 'タイムゾーン', value: 'Asia/Tokyo' }],
  })

  await interaction.reply({ embeds: [embed] })
}
