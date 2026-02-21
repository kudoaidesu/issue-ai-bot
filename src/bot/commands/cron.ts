import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js'
import { getScheduledTasks } from '../../queue/scheduler.js'

export const data = new SlashCommandBuilder()
  .setName('cron')
  .setDescription('Cronジョブの状態を確認')

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const tasks = getScheduledTasks()

  const embed = new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle('Cronジョブ一覧')
    .setDescription(
      tasks
        .map((t) => `**${t.name}** — \`${t.schedule}\``)
        .join('\n'),
    )
    .addFields({
      name: 'タイムゾーン',
      value: 'Asia/Tokyo',
    })
    .setTimestamp()

  await interaction.reply({ embeds: [embed] })
}
