import { type Message } from 'discord.js'
import { config, type ProjectConfig } from '../../config.js'
import { refineIssue } from '../../agents/issue-refiner/index.js'
import { createIssue } from '../../github/issues.js'
import { enqueue } from '../../queue/processor.js'
import { notifyIssueCreated } from '../notifier.js'
import { createLogger } from '../../utils/logger.js'
import { validateDiscordInput, sanitizePromptInput } from '../../utils/sanitize.js'

const log = createLogger('dm-handler')

// DM会話のセッション管理（ユーザーID → セッションID）
const activeSessions = new Map<string, string>()
// DM時のプロジェクト選択を保持（ユーザーID → プロジェクト）
const userProjects = new Map<string, ProjectConfig>()

function resolveProjectForDm(userId: string): ProjectConfig | null {
  // 既に選択済み
  const cached = userProjects.get(userId)
  if (cached) return cached

  // プロジェクトが1件なら自動選択
  if (config.projects.length === 1) {
    userProjects.set(userId, config.projects[0])
    return config.projects[0]
  }

  return null
}

export async function handleMessage(message: Message): Promise<void> {
  // Bot自身のメッセージは無視
  if (message.author.bot) return

  // DMのみ処理
  if (message.guild) return

  const userId = message.author.id
  const content = message.content.trim()

  if (!content) return

  // キャンセルコマンド
  if (content.toLowerCase() === 'cancel' || content === 'キャンセル') {
    activeSessions.delete(userId)
    userProjects.delete(userId)
    await message.reply('セッションをキャンセルしました。')
    return
  }

  // プロジェクト解決
  const project = resolveProjectForDm(userId)

  // 複数プロジェクトで未選択の場合、選択を促す
  if (!project) {
    const projectList = config.projects
      .map((p, i) => `${i + 1}. ${p.slug} (${p.repo})`)
      .join('\n')

    // 番号入力を処理
    const num = Number(content)
    if (num >= 1 && num <= config.projects.length) {
      userProjects.set(userId, config.projects[num - 1])
      await message.reply(
        `プロジェクト「${config.projects[num - 1].slug}」を選択しました。Issueの内容を入力してください。`,
      )
      return
    }

    await message.reply(
      `プロジェクトを選択してください（番号を入力）:\n${projectList}\n\n(「キャンセル」で中断)`,
    )
    return
  }

  // セッション管理: ユーザーごとに1セッション
  let sessionId = activeSessions.get(userId)
  if (!sessionId) {
    sessionId = `dm-${userId}-${Date.now()}`
    activeSessions.set(userId, sessionId)
  }

  // 入力バリデーション + サニタイズ
  const validation = validateDiscordInput(content)
  if (!validation.valid) {
    await message.reply('入力が無効です。もう一度お試しください。')
    return
  }
  const sanitized = sanitizePromptInput(validation.sanitized)

  log.info(`DM from ${message.author.tag}: "${sanitized.slice(0, 50)}..."`)

  try {
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping()
    }

    const result = await refineIssue(sessionId, sanitized)

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
      repo: project.repo,
    })

    enqueue(issue.number, project.repo)

    await message.reply(
      `Issue #${issue.number} を作成しました!\n${issue.htmlUrl}`,
    )

    await notifyIssueCreated(
      issue.number,
      issue.title,
      issue.htmlUrl,
      issue.labels,
      project.channelId,
    )

    // セッション終了
    activeSessions.delete(userId)
    userProjects.delete(userId)
  } catch (err) {
    log.error('DM processing failed', err)
    await message.reply('エラーが発生しました。もう一度試してください。')
    activeSessions.delete(userId)
    userProjects.delete(userId)
  }
}
