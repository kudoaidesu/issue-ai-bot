import { SlashCommandBuilder, EmbedBuilder } from 'discord.js'
import { getStrategyReport, getDifficultyStrategyReport } from '../../utils/strategy-eval.js'

export const data = new SlashCommandBuilder()
  .setName('strategy-report')
  .setDescription('タイチョー Strategy の評価レポートを表示')
  .addStringOption((opt) =>
    opt
      .setName('mode')
      .setDescription('表示モード')
      .addChoices(
        { name: 'Strategy 別成績', value: 'strategy' },
        { name: '難易度別 Strategy 成績', value: 'difficulty' },
      )
      .setRequired(false),
  )

export async function execute(interaction: any): Promise<void> {
  const mode = interaction.options.getString('mode') ?? 'strategy'

  if (mode === 'strategy') {
    const report = getStrategyReport()

    if (report.length === 0) {
      await interaction.reply('📊 評価データがまだ記録されていません')
      return
    }

    const embed = new EmbedBuilder()
      .setColor(0x818cf8)
      .setTitle('📊 Strategy 別評価レポート')
      .setDescription(`全 ${report.reduce((sum, r) => sum + r.count, 0)} 件の処理結果から集計`)
      .addFields(
        report.map((r) => ({
          name: `🎯 ${r.strategyName}`,
          value: `**成功率**: ${r.successRate.toFixed(1)}% (${r.successCount}/${r.count} 成功)\n` +
            `**平均実行時間**: ${(r.avgDurationMs / 1000).toFixed(1)}秒\n` +
            `**平均リトライ**: ${r.avgRetryCount.toFixed(1)}回\n` +
            `**総変更行数**: +${r.totalLinesAdded} -${r.totalLinesRemoved}`,
          inline: false,
        })),
      )
      .setFooter({ text: '詳細: /strategy-report mode:難易度別' })
      .setTimestamp()

    await interaction.reply({ embeds: [embed] })
  } else {
    const report = getDifficultyStrategyReport()

    if (report.length === 0) {
      await interaction.reply('📊 評価データがまだ記録されていません')
      return
    }

    // 難易度ごとにグループ化
    const groupedByDifficulty = new Map<string, typeof report>()
    for (const r of report) {
      const key = r.difficulty
      if (!groupedByDifficulty.has(key)) {
        groupedByDifficulty.set(key, [])
      }
      groupedByDifficulty.get(key)!.push(r)
    }

    const difficultyOrder = { S: '🟢 Simple', M: '🟡 Medium', L: '🟠 Large', XL: '🔴 XLarge' }

    const embed = new EmbedBuilder()
      .setColor(0x818cf8)
      .setTitle('📊 難易度別 Strategy 成績')
      .setDescription('Issue 難易度ごとの Strategy パフォーマンス')
      .addFields(
        Array.from(groupedByDifficulty.entries()).map(([difficulty, items]) => ({
          name: difficultyOrder[difficulty as keyof typeof difficultyOrder],
          value: items
            .map(
              (r) =>
                `**${r.strategyName}**: ${r.successRate.toFixed(0)}% ` +
                `(${r.count}件, ${(r.avgDurationMs / 1000).toFixed(1)}s avg)`,
            )
            .join('\n'),
          inline: false,
        })),
      )
      .setFooter({ text: '詳細: /strategy-report mode:Strategy別成績' })
      .setTimestamp()

    await interaction.reply({ embeds: [embed] })
  }
}
