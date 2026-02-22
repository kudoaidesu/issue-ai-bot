import { type StringSelectMenuInteraction } from 'discord.js'
import { config } from '../../config.js'
import { parseCustomId } from '../theme.js'
import { setUserProject } from './messageCreate.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('select-handler')

export async function handleSelectMenuInteraction(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
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
