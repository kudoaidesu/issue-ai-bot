import { type Message } from 'discord.js'
import { findProjectByGuildId, type ProjectConfig } from '../../config.js'
import { runClaudeSdk, type ClaudeSdkResult } from '../../llm/claude-sdk.js'
import { createLogger } from '../../utils/logger.js'
import { sanitizePromptInput, validateDiscordInput } from '../../utils/sanitize.js'
import { resolveChatModel, parseModelPrefix } from '../chat-model.js'
import { getMemoryContext, saveConversation } from '../../memory/index.js'
import {
  getSession,
  createSession,
  updateSessionActivity,
  deleteSession,
} from '../../session/index.js'

const log = createLogger('guild-chat')

const SYSTEM_PROMPT = 'あなたはDiscordサーバーのアシスタントBotです。ユーザーの質問や雑談に日本語で簡潔に回答してください。2000文字以内で返してください。技術的な質問にはコード例を含めても構いません。'

async function createNewSession(
  guildId: string,
  channelId: string,
  sanitized: string,
  model: string,
  project: ProjectConfig,
): Promise<ClaudeSdkResult> {
  // 新規セッション: メモリコンテキストをシステムプロンプトに注入
  const memoryContext = await getMemoryContext(guildId, channelId, sanitized)
  const enrichedSystemPrompt = memoryContext
    ? `${SYSTEM_PROMPT}\n\n${memoryContext}`
    : SYSTEM_PROMPT

  const result = await runClaudeSdk({
    prompt: sanitized,
    systemPrompt: enrichedSystemPrompt,
    model,
    maxTurns: 3,
    cwd: project.localPath,
    settingSources: ['project'],
    permissionMode: 'bypassPermissions',
    timeoutMs: 180_000,
  })

  // セッションをレジストリに登録
  if (result.sessionId) {
    createSession({
      sessionId: result.sessionId,
      channelId,
      guildId,
      summary: sanitized.slice(0, 200),
      model,
    })
  }

  return result
}

export async function handleGuildChat(message: Message): Promise<void> {
  if (!message.guild) return
  if (message.author.bot) return

  let content = message.content
    .replace(/<@!?\d+>/g, '')
    .trim()

  if (!content) return

  const project = findProjectByGuildId(message.guild.id)
  if (!project) {
    log.warn(`Unknown guild: ${message.guild.id}`)
    return
  }

  // --model プレフィックスをパース（バリデーション前に処理）
  const { model: messageModelOverride, content: strippedContent } = parseModelPrefix(content)
  content = strippedContent

  if (!content) return

  const validation = validateDiscordInput(content)
  if (!validation.valid) return
  const sanitized = sanitizePromptInput(validation.sanitized)

  const model = resolveChatModel(message.guild.id, messageModelOverride)
  const guildId = message.guild.id
  const channelId = message.channel.id

  log.info(`Guild chat from ${message.author.tag} (model=${model}): "${sanitized.slice(0, 50)}..."`)

  try {
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping()
    }

    let result: ClaudeSdkResult
    const existingSession = getSession(channelId)

    if (existingSession) {
      // 既存セッションを resume
      try {
        result = await runClaudeSdk({
          prompt: sanitized,
          model,
          resume: existingSession.sessionId,
          maxTurns: 3,
          cwd: project.localPath,
          permissionMode: 'bypassPermissions',
          timeoutMs: 180_000,
        })
        updateSessionActivity(channelId, sanitized.slice(0, 200))
        log.info(`Resumed session ${existingSession.sessionId.slice(0, 12)}...`)
      } catch (err) {
        // resume 失敗 → セッション削除して新規作成
        log.warn(`Session resume failed, creating new session: ${err}`)
        deleteSession(channelId)
        result = await createNewSession(guildId, channelId, sanitized, model, project)
      }
    } else {
      // 新規セッション作成
      result = await createNewSession(guildId, channelId, sanitized, model, project)
    }

    // SDK が 0 文字を返した場合（ツール実行のみで終わった場合）、要約を要求する
    if (!result.content && result.sessionId) {
      log.info(`SDK returned 0 chars, requesting summary from session ${result.sessionId.slice(0, 12)}...`)
      try {
        const summaryResult = await runClaudeSdk({
          prompt: '今の操作の結果を日本語で簡潔に教えてください。',
          model,
          resume: result.sessionId,
          maxTurns: 1,
          cwd: project.localPath,
          permissionMode: 'bypassPermissions',
          timeoutMs: 30_000,
        })
        result = summaryResult
      } catch (err) {
        log.warn(`Summary request failed: ${err}`)
      }
    }

    const reply = result.content.slice(0, 2000)
    await message.reply(reply || '処理は完了しましたが、返答内容を取得できませんでした。')

    // 会話をメモリにも保存（検索/コンパクション用）
    const now = new Date().toISOString()
    await saveConversation(guildId, channelId, [
      { role: 'user', userId: message.author.id, username: message.author.tag, content: sanitized, timestamp: now },
      { role: 'assistant', content: result.content, timestamp: now },
    ])
  } catch (err) {
    log.error('Guild chat failed', err)
    await message.reply('すみません、応答の生成に失敗しました。')
  }
}
