import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js'
import { getStats } from '../../queue/processor.js'
import { runNow } from '../../queue/scheduler.js'

export const data = new SlashCommandBuilder()
  .setName('run')
  .setDescription('手動でキュー処理を開始')

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const stats = getStats()

  if (stats.pending === 0) {
    await interaction.reply('待機中のアイテムはありません。')
    return
  }

  await interaction.deferReply()

  await runNow()

  const after = getStats()
  await interaction.editReply(
    `キュー処理完了 — 完了: ${after.completed}, 失敗: ${after.failed}, 残: ${after.pending}`,
  )
}
