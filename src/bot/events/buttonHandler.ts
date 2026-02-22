import { type ButtonInteraction } from 'discord.js'
import { parseCustomId } from '../theme.js'
import { findById, removeItem } from '../../queue/processor.js'
import { runNow } from '../../queue/scheduler.js'
import { mergePr } from '../../github/pulls.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('button-handler')

export async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const { action, payload } = parseCustomId(interaction.customId)

  switch (action) {
    case 'queue_process':
      await handleQueueProcessNow(interaction, payload)
      break
    case 'queue_remove':
      await handleQueueRemove(interaction, payload)
      break
    case 'pr_merge':
      await handlePrMerge(interaction, payload)
      break
    default:
      log.warn(`Unknown button action: ${action}`)
      await interaction.reply({ content: '不明なボタンです。', ephemeral: true })
  }
}

async function handleQueueProcessNow(
  interaction: ButtonInteraction,
  queueItemId: string,
): Promise<void> {
  const item = findById(queueItemId)
  if (!item) {
    await interaction.reply({ content: 'キューアイテムが見つかりません。', ephemeral: true })
    return
  }

  if (item.status !== 'pending') {
    await interaction.reply({
      content: `このアイテムは既に「${item.status}」状態です。`,
      ephemeral: true,
    })
    return
  }

  await interaction.deferReply({ ephemeral: true })
  void runNow()
  await interaction.editReply(`Issue #${item.issueNumber} のキュー処理を開始しました。`)

  // ボタン無効化
  try {
    await interaction.message.edit({ components: [] })
  } catch {
    // メッセージが削除済みの場合
  }
}

async function handleQueueRemove(
  interaction: ButtonInteraction,
  queueItemId: string,
): Promise<void> {
  const item = findById(queueItemId)
  if (!item) {
    await interaction.reply({ content: 'キューアイテムが見つかりません。', ephemeral: true })
    return
  }

  if (item.status === 'processing') {
    await interaction.reply({
      content: '処理中のアイテムは削除できません。',
      ephemeral: true,
    })
    return
  }

  const removed = removeItem(queueItemId)
  if (removed) {
    await interaction.reply({
      content: `Issue #${item.issueNumber} をキューから削除しました。`,
      ephemeral: true,
    })
    try {
      await interaction.message.edit({ components: [] })
    } catch {
      // pass
    }
  } else {
    await interaction.reply({ content: '削除に失敗しました。', ephemeral: true })
  }
}

async function handlePrMerge(
  interaction: ButtonInteraction,
  prUrl: string,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true })

  try {
    await mergePr(prUrl)
    await interaction.editReply('PR をマージしました。')

    try {
      await interaction.message.edit({ components: [] })
    } catch {
      // pass
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await interaction.editReply(`マージに失敗しました: ${message}`)
  }
}
