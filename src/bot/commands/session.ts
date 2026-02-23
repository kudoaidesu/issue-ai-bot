import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
} from 'discord.js'
import {
  getSession,
  getSessionsByGuild,
  archiveSession,
} from '../../session/index.js'
import { COLORS, createEmbed } from '../theme.js'
import { formatAge } from '../session-runner.js'
import { getModelDisplayName } from '../chat-model.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('session-command')

export const SESSION_SWITCH_SELECT_ID = 'session_switch'

export const data = new SlashCommandBuilder()
  .setName('session')
  .setDescription('セッション管理')
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('このサーバーのアクティブセッション一覧'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('new')
      .setDescription('このチャンネルのセッションをリセット（次メッセージから新規）'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('switch')
      .setDescription('別のセッションをこのチャンネルに切り替え'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('info')
      .setDescription('このチャンネルの現在のセッション情報'),
  )

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId
  if (!guildId) {
    await interaction.reply({ content: 'サーバー内でのみ使用できます。', ephemeral: true })
    return
  }

  const subcommand = interaction.options.getSubcommand()

  switch (subcommand) {
    case 'list': {
      const sessions = getSessionsByGuild(guildId)

      if (sessions.length === 0) {
        const embed = createEmbed(COLORS.info, 'セッション一覧', {
          description: 'アクティブなセッションはありません。',
        })
        await interaction.reply({ embeds: [embed], ephemeral: true })
        return
      }

      const lines = sessions.map((s, i) => {
        const age = formatAge(s.lastActiveAt)
        const current = s.channelId === interaction.channelId ? ' **[現在]**' : ''
        return `**${i + 1}.** ${s.summary.slice(0, 80)}${current}\n` +
          `   \u{1f4ac} ${s.messageCount}件 | \u{1f916} ${getModelDisplayName(s.model)} | \u{23f0} ${age} | <#${s.channelId}>`
      })

      const embed = createEmbed(COLORS.info, `セッション一覧 (${sessions.length}件)`, {
        description: lines.join('\n\n'),
        footer: '/ask session: でセッションを選択して継続できます',
      })

      await interaction.reply({ embeds: [embed], ephemeral: true })
      break
    }

    case 'new': {
      const channelId = interaction.channelId
      const current = getSession(channelId)

      if (!current) {
        await interaction.reply({ content: 'このチャンネルにアクティブなセッションはありません。', ephemeral: true })
        return
      }

      archiveSession(channelId)
      log.info(`Session archived by /session new: ${current.sessionId.slice(0, 12)}... in channel ${channelId}`)

      const embed = createEmbed(COLORS.success, 'セッションをリセット', {
        description: `セッション「${current.summary.slice(0, 60)}」をアーカイブしました。\n次のメッセージから新しいセッションが始まります。`,
      })

      await interaction.reply({ embeds: [embed] })
      break
    }

    case 'switch': {
      const channelId = interaction.channelId
      const sessions = getSessionsByGuild(guildId)
      const otherSessions = sessions.filter((s) => s.channelId !== channelId)

      if (otherSessions.length === 0) {
        await interaction.reply({ content: '切り替え可能なセッションがありません。', ephemeral: true })
        return
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(SESSION_SWITCH_SELECT_ID)
        .setPlaceholder('切り替えるセッションを選択...')
        .addOptions(
          otherSessions.slice(0, 25).map((s) => {
            const age = formatAge(s.lastActiveAt)
            return {
              label: s.summary.slice(0, 80),
              description: `${s.messageCount}件 | ${getModelDisplayName(s.model)} | ${age}`,
              value: s.sessionId,
            }
          }),
        )

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)

      await interaction.reply({
        content: 'このチャンネルに切り替えるセッションを選択してください:',
        components: [row],
        ephemeral: true,
      })
      break
    }

    case 'info': {
      const channelId = interaction.channelId
      const session = getSession(channelId)

      if (!session) {
        const embed = createEmbed(COLORS.info, 'セッション情報', {
          description: 'このチャンネルにアクティブなセッションはありません。\n次のメッセージで自動的に新規セッションが作成されます。',
        })
        await interaction.reply({ embeds: [embed], ephemeral: true })
        return
      }

      const embed = createEmbed(COLORS.info, 'セッション情報', {
        fields: [
          { name: 'サマリー', value: session.summary.slice(0, 200) },
          { name: 'セッションID', value: `\`${session.sessionId.slice(0, 16)}...\``, inline: true },
          { name: 'モデル', value: getModelDisplayName(session.model), inline: true },
          { name: 'メッセージ数', value: `${session.messageCount}件`, inline: true },
          { name: '作成日時', value: session.createdAt, inline: true },
          { name: '最終アクティブ', value: `${session.lastActiveAt} (${formatAge(session.lastActiveAt)})`, inline: true },
        ],
      })

      await interaction.reply({ embeds: [embed], ephemeral: true })
      break
    }
  }
}
