import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js'
import { getLatestUsage, scrapeUsage, evaluateAlerts } from '../../utils/usage-monitor.js'
import type { UsageReport, UsageSnapshot } from '../../utils/usage-monitor.js'
import { COLORS, createEmbed } from '../theme.js'

export const data = new SlashCommandBuilder()
  .setName('usage')
  .setDescription('LLM使用量を確認')
  .addBooleanOption((opt) =>
    opt
      .setName('refresh')
      .setDescription('最新データを取得する（時間がかかります）')
      .setRequired(false),
  )

function formatClaudeSnapshot(snapshot: UsageSnapshot | null): string {
  if (!snapshot) return 'データなし（まだ取得されていません）'
  if (snapshot.error) return `**エラー**: ${snapshot.error.slice(0, 200)}`

  const claude = snapshot.claude
  if (!claude) return snapshot.raw.slice(0, 300) || 'パース失敗'

  const parts: string[] = []

  if (claude.session) {
    const s = claude.session
    const status = s.rateLimited ? '**制限中**' : `${s.usagePercent}%`
    parts.push(`セッション: ${status}${s.remaining ? ` (残り ${s.remaining})` : ''}`)
  }

  if (claude.weekly) {
    for (const m of claude.weekly.models) {
      const pct = m.usagePercent !== undefined ? `${m.usagePercent}%` : '?%'
      parts.push(`${m.model}: ${pct}${m.usageText ? ` [${m.usageText}]` : ''}`)
    }
    if (claude.weekly.resetAt) {
      parts.push(`リセット: ${claude.weekly.resetAt}`)
    }
  }

  return parts.length > 0 ? parts.join('\n').slice(0, 1024) : 'パース失敗'
}

function formatCodexSnapshot(snapshot: UsageSnapshot | null): string {
  if (!snapshot) return 'データなし（まだ取得されていません）'
  if (snapshot.error) return `**エラー**: ${snapshot.error.slice(0, 200)}`

  const codex = snapshot.codex
  if (!codex) return snapshot.raw.slice(0, 300) || 'パース失敗'

  const parts: string[] = []
  if (codex.usagePercent !== undefined) {
    parts.push(`使用率: **${codex.usagePercent}%**`)
  }
  if (codex.usageText) {
    parts.push(`タスク: ${codex.usageText}`)
  }
  if (codex.resetAt) {
    parts.push(`リセット: ${codex.resetAt}`)
  }

  return parts.length > 0 ? parts.join('\n').slice(0, 1024) : 'パース失敗'
}

function buildUsageEmbed(report: UsageReport) {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = []

  fields.push({
    name: 'Claude (Max)',
    value: formatClaudeSnapshot(report.claude),
    inline: false,
  })

  fields.push({
    name: 'OpenAI Codex',
    value: formatCodexSnapshot(report.codex),
    inline: false,
  })

  // Alert summary
  const alerts = evaluateAlerts(report)
  if (alerts.hasAlerts) {
    const alertLines: string[] = []
    if (alerts.sessionRateLimited) alertLines.push(`⚠️ ${alerts.sessionDetail}`)
    if (alerts.wakeTimeConflict) alertLines.push(`⏰ ${alerts.wakeTimeDetail}`)
    if (alerts.weeklyPaceExceeded) alertLines.push(`📈 ${alerts.weeklyPaceDetail}`)
    if (alerts.sonnetPaceExceeded) alertLines.push(`📈 ${alerts.sonnetPaceDetail}`)
    if (alerts.codexPaceExceeded) alertLines.push(`📈 ${alerts.codexPaceDetail}`)

    fields.push({
      name: 'アラート',
      value: alertLines.join('\n').slice(0, 1024),
      inline: false,
    })
  }

  const hasErrors = report.claude?.error ?? report.codex?.error
  const color = hasErrors ? COLORS.error : alerts.hasAlerts ? COLORS.warning : COLORS.info

  return createEmbed(color, 'LLM 使用量', {
    fields,
    footer: `最終取得: ${new Date(report.scrapedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
  })
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const refresh = interaction.options.getBoolean('refresh') ?? false

  if (refresh) {
    await interaction.deferReply()
    const report = await scrapeUsage()
    const embed = buildUsageEmbed(report)
    await interaction.editReply({ embeds: [embed] })
  } else {
    const report = getLatestUsage()
    const embed = buildUsageEmbed(report)
    await interaction.reply({ embeds: [embed] })
  }
}
