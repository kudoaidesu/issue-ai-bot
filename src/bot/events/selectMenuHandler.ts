import { type StringSelectMenuInteraction } from 'discord.js'
import { config } from '../../config.js'
import { parseCustomId, COLORS, createEmbed } from '../theme.js'
import { setUserProject } from './messageCreate.js'
import { setRuntimeModel, getModelDisplayName } from '../chat-model.js'
import { MODEL_SELECT_ID } from '../commands/model.js'
import { SESSION_SWITCH_SELECT_ID } from '../commands/session.js'
import { reassignSession, getSessionById } from '../../session/index.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('select-handler')

export async function handleSelectMenuInteraction(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  // モデル選択メニュー
  if (interaction.customId === MODEL_SELECT_ID) {
    const guildId = interaction.guildId
    if (!guildId) {
      await interaction.reply({ content: 'サーバー内でのみ使用できます。', ephemeral: true })
      return
    }

    const selectedModel = interaction.values[0]
    setRuntimeModel(guildId, selectedModel)

    const embed = createEmbed(COLORS.success, 'モデルを変更しました', {
      description: `チャットモデルを **${getModelDisplayName(selectedModel)}** に設定しました。\nBot再起動でリセットされます。`,
    })

    await interaction.reply({ embeds: [embed] })
    return
  }

  // セッション切替メニュー
  if (interaction.customId === SESSION_SWITCH_SELECT_ID) {
    const channelId = interaction.channelId
    const selectedSessionId = interaction.values[0]

    const session = getSessionById(selectedSessionId)
    if (!session) {
      await interaction.reply({ content: 'セッションが見つかりません（期限切れの可能性があります）。', ephemeral: true })
      return
    }

    reassignSession(selectedSessionId, channelId)

    const embed = createEmbed(COLORS.success, 'セッションを切り替えました', {
      description: `「${session.summary.slice(0, 60)}」をこのチャンネルに切り替えました。\n次のメッセージからこのセッションが継続されます。`,
    })

    await interaction.reply({ embeds: [embed] })
    return
  }

  const { action } = parseCustomId(interaction.customId)

  if (action !== 'project_select') {
    log.warn(`Unknown select menu action: ${action}`)
    await interaction.reply({ content: '不明な選択メニューです。', ephemeral: true })
    return
  }

  const selectedSlug = interaction.values[0]
  const project = config.projects.find((p) => p.slug === selectedSlug)

  if (!project) {
    await interaction.reply({ content: 'プロジェクトが見つかりません。', ephemeral: true })
    return
  }

  setUserProject(interaction.user.id, project)

  await interaction.reply(
    `プロジェクト「${project.slug}」を選択しました。Issueの内容をDMで入力してください。`,
  )
}
