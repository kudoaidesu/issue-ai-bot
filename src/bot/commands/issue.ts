import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js'
import { refineIssue } from '../../agents/issue-refiner/index.js'
import { createIssue } from '../../github/issues.js'
import { enqueue } from '../../queue/processor.js'
import { notifyIssueCreated } from '../notifier.js'

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
  const content = interaction.options.getString('content', true)
  const sessionId = `slash-${interaction.user.id}-${Date.now()}`

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
  })

  enqueue(issue.number)

  await interaction.editReply(
    `Issue #${issue.number} を作成しました: ${issue.htmlUrl}`,
  )

  await notifyIssueCreated(
    issue.number,
    issue.title,
    issue.htmlUrl,
    issue.labels,
  )
}
