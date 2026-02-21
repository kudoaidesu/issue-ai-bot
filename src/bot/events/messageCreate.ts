import { type Message } from 'discord.js'
import { refineIssue } from '../../agents/issue-refiner/index.js'
import { createIssue } from '../../github/issues.js'
import { enqueue } from '../../queue/processor.js'
import { notifyIssueCreated } from '../notifier.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('dm-handler')

// DM会話のセッション管理（ユーザーID → セッションID）
const activeSessions = new Map<string, string>()

export async function handleMessage(message: Message): Promise<void> {
  // Bot自身のメッセージは無視
  if (message.author.bot) return

  // DMのみ処理
  if (message.guild) return

  const userId = message.author.id
  const content = message.content.trim()

  if (!content) return

  // セッション管理: ユーザーごとに1セッション
  let sessionId = activeSessions.get(userId)
  if (!sessionId) {
    sessionId = `dm-${userId}-${Date.now()}`
    activeSessions.set(userId, sessionId)
  }

  // キャンセルコマンド
  if (content.toLowerCase() === 'cancel' || content === 'キャンセル') {
    activeSessions.delete(userId)
    await message.reply('セッションをキャンセルしました。')
    return
  }

  log.info(`DM from ${message.author.tag}: "${content.slice(0, 50)}..."`)

  try {
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping()
    }

    const result = await refineIssue(sessionId, content)

    if (result.status === 'needs_info') {
      const questions = result.questions
        .map((q, i) => `${i + 1}. ${q}`)
        .join('\n')
      await message.reply(
        `もう少し教えてください:\n${questions}\n\n(「キャンセル」で中断)`,
      )
      return
    }

    // Issue作成
    const issue = await createIssue({
      title: result.title,
      body: result.body,
      labels: result.labels,
    })

    enqueue(issue.number)

    await message.reply(
      `Issue #${issue.number} を作成しました!\n${issue.htmlUrl}`,
    )

    await notifyIssueCreated(
      issue.number,
      issue.title,
      issue.htmlUrl,
      issue.labels,
    )

    // セッション終了
    activeSessions.delete(userId)
  } catch (err) {
    log.error('DM processing failed', err)
    await message.reply('エラーが発生しました。もう一度試してください。')
    activeSessions.delete(userId)
  }
}
