import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js'
import { findProjectByGuildId } from '../../config.js'
import { refineIssue } from '../../agents/torisan/index.js'
import { createIssue } from '../../github/issues.js'
import { enqueue } from '../../queue/processor.js'
import { processImmediate } from '../../queue/scheduler.js'
import { notifyIssueCreated, notifyImmediateStart } from '../notifier.js'
import { validateDiscordInput, sanitizePromptInput } from '../../utils/sanitize.js'

export const data = new SlashCommandBuilder()
  .setName('issue')
  .setDescription('新しいIssueリクエストを送信')
  .addStringOption((option) =>
    option
      .setName('content')
      .setDescription('Issueの内容（メモ、バグ報告、機能要望など）')
      .setRequired(true),
  )

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const rawContent = interaction.options.getString('content', true)
  const sessionId = `slash-${interaction.user.id}-${Date.now()}`

  const project = interaction.guildId
    ? findProjectByGuildId(interaction.guildId)
    : undefined

  if (!project) {
    await interaction.reply({
      content: 'このサーバーに紐づくプロジェクトが見つかりません。projects.json を確認してください。',
      ephemeral: true,
    })
    return
  }

  const validation = validateDiscordInput(rawContent)
  if (!validation.valid) {
    await interaction.reply({ content: '入力が無効です。', ephemeral: true })
    return
  }
  const content = sanitizePromptInput(validation.sanitized)

  await interaction.deferReply()

  const result = await refineIssue(sessionId, content)

  if (result.status === 'needs_info') {
    const questions = result.questions
      .map((q, i) => `${i + 1}. ${q}`)
      .join('\n')
    await interaction.editReply(
      `もう少し情報が必要です:\n${questions}\n\nDMで回答してください。セッションID: \`${sessionId}\``,
    )
    return
  }

  const issue = await createIssue({
    title: result.title,
    body: result.body,
    labels: result.labels,
    repo: project.repo,
  })

  if (result.urgency === 'immediate') {
    const immediateResult = await processImmediate(issue.number, project.repo)

    switch (immediateResult.status) {
      case 'started':
        await interaction.editReply(
          `Issue #${issue.number} を作成し、即時処理を開始しました: ${issue.htmlUrl}`,
        )
        await notifyImmediateStart(
          issue.number, issue.title, issue.htmlUrl, issue.labels, project.channelId,
        )
        break

      case 'locked': {
        const queueItem = enqueue(issue.number, project.repo, 'high')
        await interaction.editReply(
          `Issue #${issue.number} を作成しました（処理中タスクあり、高優先度でキューに追加）: ${issue.htmlUrl}`,
        )
        if (queueItem) {
          await notifyIssueCreated(
            issue.number, issue.title, issue.htmlUrl, issue.labels,
            project.channelId, queueItem.id,
          )
        }
        break
      }


      case 'no_handler': {
        const queueItem = enqueue(issue.number, project.repo, 'high')
        await interaction.editReply(
          `Issue #${issue.number} を作成し、キューに追加しました: ${issue.htmlUrl}`,
        )
        if (queueItem) {
          await notifyIssueCreated(
            issue.number, issue.title, issue.htmlUrl, issue.labels,
            project.channelId, queueItem.id,
          )
        }
        break
      }
    }
  } else {
    const queueItem = enqueue(issue.number, project.repo)

    if (queueItem) {
      await interaction.editReply(
        `Issue #${issue.number} を作成しました: ${issue.htmlUrl}`,
      )
      await notifyIssueCreated(
        issue.number, issue.title, issue.htmlUrl, issue.labels,
        project.channelId, queueItem.id,
      )
    } else {
      await interaction.editReply(
        `Issue #${issue.number} を作成しました（既にキューに存在）: ${issue.htmlUrl}`,
      )
    }
  }
}
