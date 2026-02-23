/**
 * /state コマンド — システム全体の状態を一括取得・表示
 *
 * 以下の情報を取得して表示:
 * - キュー状態 (待機/処理中/完了/失敗)
 * - LLM使用率 (Claude, Codex + アラート)
 * - Issue状態 (Open/Closed)
 * - PR状態 (Draft/Open/Closed)
 * - Cronジョブ
 * - アクティブセッション
 */

import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from 'discord.js'
import { getStats, getAll } from '../../queue/processor.js'
import { getScheduledTasks } from '../../queue/scheduler.js'
import { getLatestUsage } from '../../utils/usage-monitor.js'
import { getAllSessions } from '../../session/index.js'
import { COLORS, createEmbed } from '../theme.js'

export const data = new SlashCommandBuilder()
  .setName('state')
  .setDescription('[状態更新] システム全体の状態を一括取得')

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply()

  try {
    const timestamp = new Date().toLocaleTimeString('ja-JP', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })

    // ===== データ取得 =====
    const stats = getStats()
    const queueItems = getAll()
    const cronTasks = getScheduledTasks()
    const usage = getLatestUsage()
    const sessions = getAllSessions()

    // ===== キュー状態 =====
    const queueEmbed = createEmbed(COLORS.info, '📊 キュー状態', {
      description: `⏰ ${timestamp}`,
      fields: [
        {
          name: '統計',
          value: [
            `🔵 待機中: **${stats.pending}**`,
            `🟡 処理中: **${stats.processing}**`,
            `🟢 完了: **${stats.completed}**`,
            `🔴 失敗: **${stats.failed}**`,
            `📈 合計: **${stats.total}**`,
          ].join('\n'),
          inline: false,
        },
        ...(stats.pending > 0
          ? [
              {
                name: '待機中のアイテム',
                value: queueItems
                  .filter((q) => q.status === 'pending')
                  .slice(0, 5)
                  .map(
                    (q) =>
                      `• **#${q.issueNumber}** — \`${q.status}\` ${
                        q.attemptedAt
                          ? `（${new Date(q.attemptedAt).toLocaleString('ja-JP')}）`
                          : ''
                      }`,
                  )
                  .join('\n'),
                inline: false,
              },
            ]
          : []),
      ],
    })

    // ===== LLM使用率 =====
    const llmEmbed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('⚡ LLM使用率')
      .setDescription(`⏰ ${timestamp}`)

    if (usage) {
      const claudeInfo = usage.claude
        ? [
            `Claude: ${claudeInfo?.sessionPercent ?? '?'}% ${
              claudeInfo?.sessionPercent && claudeInfo.sessionPercent > 80
                ? '⚠️'
                : '✅'
            }`,
            `  └─ 週次 Sonnet: ${usage.claude.weeklySonnetPercent ?? '?'}%`,
            `  └─ 週次全体: ${usage.claude.weeklyAllPercent ?? '?'}%`,
          ].join('\n')
        : 'Claude: 情報なし'

      const codexInfo =
        usage.codex && usage.codex.usagePercent !== null
          ? `Codex: ${usage.codex.usagePercent}% ${
              usage.codex.usagePercent > 80 ? '⚠️ Pace制限' : '✅'
            }`
          : 'Codex: 情報なし'

      llmEmbed.addFields([
        { name: 'Claude', value: claudeInfo, inline: false },
        { name: 'Codex', value: codexInfo, inline: false },
      ])
    } else {
      llmEmbed.setDescription('LLM使用情報が利用できません')
    }

    // ===== Cronジョブ =====
    const cronEmbed = createEmbed(COLORS.info, '⏱️ Cronジョブ', {
      description: cronTasks
        .map((t) => `• **${t.name}**: \`${t.schedule}\``)
        .join('\n') || 'スケジュール済みジョブなし',
    })

    // ===== アクティブセッション =====
    const sessionEmbed = createEmbed(
      COLORS.success,
      '💬 アクティブセッション',
      {
        description:
          sessions.length > 0
            ? sessions
                .slice(0, 5)
                .map((s) => `• **${s.guildId}**: ${s.sessionId}`)
                .join('\n')
            : 'アクティブセッションなし',
      },
    )

    // ===== 返信 =====
    await interaction.editReply({
      embeds: [queueEmbed, llmEmbed, cronEmbed, sessionEmbed],
    })
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : '不明なエラーが発生しました'
    await interaction.editReply({
      embeds: [
        createEmbed(COLORS.error, '❌ エラー', {
          description: errorMsg,
        }),
      ],
    })
  }
}
