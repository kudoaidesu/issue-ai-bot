import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js'
import { getCostReport } from '../../utils/cost-tracker.js'
import { COLORS, createEmbed } from '../theme.js'

export const data = new SlashCommandBuilder()
  .setName('cost')
  .setDescription('コスト情報を表示')

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const report = getCostReport()

  const repoBreakdown = report.byRepository
    .map((r) => `  ${r.repository}: $${r.costUsd.toFixed(2)}`)
    .join('\n')

  const recentList = report.recentEntries
    .slice(0, 5)
    .map((e) => {
      const status = e.success ? '✅' : '❌'
      return `${status} Issue #${e.issueNumber}: $${e.costUsd.toFixed(2)} / ${Math.round(e.durationMs / 1000)}秒`
    })
    .join('\n')

  const color = report.dailyBudgetUsedPercent >= 80 ? COLORS.warning : COLORS.info

  const embed = createEmbed(color, 'コストレポート', {
    fields: [
      { name: '本日', value: `$${report.today.toFixed(2)}`, inline: true },
      { name: '今週', value: `$${report.thisWeek.toFixed(2)}`, inline: true },
      { name: '今月', value: `$${report.thisMonth.toFixed(2)}`, inline: true },
      { name: '日次予算使用率', value: `${report.dailyBudgetUsedPercent.toFixed(0)}%`, inline: true },
      { name: 'プロジェクト別（今月）', value: repoBreakdown || 'データなし' },
      { name: '直近の処理', value: recentList || 'データなし' },
    ],
  })

  await interaction.reply({ embeds: [embed] })
}
