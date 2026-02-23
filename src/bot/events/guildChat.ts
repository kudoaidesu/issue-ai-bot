import { type Message, type TextChannel } from 'discord.js'
import { findProjectByGuildId } from '../../config.js'
import { createLogger } from '../../utils/logger.js'
import { sanitizePromptInput, validateDiscordInput } from '../../utils/sanitize.js'
import { resolveChatModel, parseModelPrefix } from '../chat-model.js'
import { getSession } from '../../session/index.js'
import {
  createNewSessionAndRun,
  resumeSessionAndRun,
  requestSummaryIfEmpty,
  saveToMemory,
} from '../session-runner.js'

const log = createLogger('guild-chat')

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

  // チャンネル名・トピックを取得
  const channel = message.channel
  const channelName = 'name' in channel ? (channel as TextChannel).name : undefined
  const channelTopic = 'topic' in channel ? (channel as TextChannel).topic ?? undefined : undefined

  log.info(`Guild chat from ${message.author.tag} (model=${model}): "${sanitized.slice(0, 50)}..."`)

  try {
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping()
    }

    const existingSession = getSession(channelId)

    let result = existingSession
      ? await resumeSessionAndRun(
          existingSession.sessionId, channelId, sanitized, model, project, guildId, channelName, channelTopic,
        )
      : await createNewSessionAndRun(
          guildId, channelId, sanitized, model, project, channelName, channelTopic,
        )

    // SDK が 0 文字を返した場合の要約フォールバック
    result = await requestSummaryIfEmpty(result, model, project)

    const reply = result.content.slice(0, 2000)
    await message.reply(reply || '処理は完了しましたが、返答内容を取得できませんでした。')

    // 会話をメモリに保存
    await saveToMemory(guildId, channelId, message.author.id, message.author.tag, sanitized, result.content)
  } catch (err) {
    log.error('Guild chat failed', err)
    await message.reply('すみません、応答の生成に失敗しました。')
  }
}
