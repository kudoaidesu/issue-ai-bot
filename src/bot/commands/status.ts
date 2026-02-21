import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js'
import { getStats } from '../../queue/processor.js'
import { getScheduledTasks } from '../../queue/scheduler.js'

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('キューとCronの状態を確認')

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const stats = getStats()
  const cronTasks = getScheduledTasks()

  const embed = new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle('システムステータス')
    .addFields(
      {
        name: 'キュー',
        value: [
          `待機中: ${stats.pending}`,
          `処理中: ${stats.processing}`,
          `完了: ${stats.completed}`,
          `失敗: ${stats.failed}`,
          `合計: ${stats.total}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Cronジョブ',
        value: cronTasks
          .map((t) => `${t.name}: \`${t.schedule}\``)
          .join('\n'),
        inline: true,
      },
    )
    .setTimestamp()

  await interaction.reply({ embeds: [embed] })
}
