import { type Message } from 'discord.js'
import { config, type ProjectConfig } from '../../config.js'
import { refineIssue } from '../../agents/torisan/index.js'
import { createIssue } from '../../github/issues.js'
import { enqueue } from '../../queue/processor.js'
import { processImmediate } from '../../queue/scheduler.js'
import { notifyIssueCreated, notifyImmediateStart } from '../notifier.js'
import { createLogger } from '../../utils/logger.js'
import { validateDiscordInput, sanitizePromptInput } from '../../utils/sanitize.js'
import { createProjectSelectMenu } from '../theme.js'
import {
  getSession,
  createSession as createRegistrySession,
  deleteSession as deleteRegistrySession,
} from '../../session/index.js'

const log = createLogger('dm-handler')

// DM時のプロジェクト選択を保持（ユーザーID → プロジェクト）
const userProjects = new Map<string, ProjectConfig>()

export function setUserProject(userId: string, project: ProjectConfig): void {
  userProjects.set(userId, project)
}

function dmChannelKey(userId: string): string {
  return `dm-${userId}`
}

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

  const channelKey = dmChannelKey(userId)

  // キャンセルコマンド
  if (content.toLowerCase() === 'cancel' || content === 'キャンセル') {
    deleteRegistrySession(channelKey)
    userProjects.delete(userId)
    await message.reply('セッションをキャンセルしました。')
    return
  }

  // プロジェクト解決
  const project = resolveProjectForDm(userId)

  // 複数プロジェクトで未選択の場合、セレクトメニューを表示
  if (!project) {
    const selectRow = createProjectSelectMenu(
      config.projects.map((p) => ({ slug: p.slug, repo: p.repo })),
    )

    await message.reply({
      content: 'プロジェクトを選択してください:',
      components: [selectRow],
    })
    return
  }

  // セッション管理: SessionRegistry から取得 or 新規作成
  let sessionId: string
  const existingSession = getSession(channelKey)
  if (existingSession) {
    sessionId = existingSession.sessionId
  } else {
    sessionId = `dm-${userId}-${Date.now()}`
    createRegistrySession({
      sessionId,
      channelId: channelKey,
      guildId: 'dm',
      summary: content.slice(0, 200),
      model: 'sonnet',
    })
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

    if (result.urgency === 'immediate') {
      // 即時処理を試行
      const immediateResult = await processImmediate(issue.number, project.repo)

      switch (immediateResult.status) {
        case 'started':
          await message.reply(
            `Issue #${issue.number} を作成し、即時処理を開始しました!\n${issue.htmlUrl}`,
          )
          await notifyImmediateStart(
            issue.number, issue.title, issue.htmlUrl, issue.labels, project.channelId,
          )
          break

        case 'locked': {
          const queueItem = enqueue(issue.number, project.repo, 'high')
          await message.reply(
            `Issue #${issue.number} を作成しました。現在別のタスクが処理中のため、高優先度でキューに追加しました。\n${issue.htmlUrl}`,
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
          await message.reply(
            `Issue #${issue.number} を作成し、キューに追加しました。\n${issue.htmlUrl}`,
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
      // 通常のキュー追加パス
      const queueItem = enqueue(issue.number, project.repo)

      if (queueItem) {
        await message.reply(`Issue #${issue.number} を作成しました!\n${issue.htmlUrl}`)
        await notifyIssueCreated(
          issue.number, issue.title, issue.htmlUrl, issue.labels,
          project.channelId, queueItem.id,
        )
      } else {
        await message.reply(
          `Issue #${issue.number} を作成しました（既にキューに存在するためスキップ）。\n${issue.htmlUrl}`,
        )
      }
    }

    // セッション終了
    deleteRegistrySession(channelKey)
    userProjects.delete(userId)
  } catch (err) {
    log.error('DM processing failed', err)
    await message.reply('エラーが発生しました。もう一度試してください。')
    deleteRegistrySession(channelKey)
    userProjects.delete(userId)
  }
}
