import { type Message } from 'discord.js'
import { findProjectByGuildId } from '../../config.js'
import { runClaudeCli } from '../../llm/claude-cli.js'
import { createLogger } from '../../utils/logger.js'
import { sanitizePromptInput, validateDiscordInput } from '../../utils/sanitize.js'
import { resolveChatModel, parseModelPrefix } from '../chat-model.js'
import { getMemoryContext, saveConversation } from '../../memory/index.js'

const log = createLogger('guild-chat')

const SYSTEM_PROMPT = 'あなたはDiscordサーバーのアシスタントBotです。ユーザーの質問や雑談に日本語で簡潔に回答してください。2000文字以内で返してください。技術的な質問にはコード例を含めても構いません。'

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

    // メモリコンテキストを構築してシステムプロンプトに注入
    const memoryContext = await getMemoryContext(guildId, channelId, sanitized)
    const enrichedSystemPrompt = memoryContext
      ? `${SYSTEM_PROMPT}\n\n${memoryContext}`
      : SYSTEM_PROMPT

    const result = await runClaudeCli({
      prompt: sanitized,
      systemPrompt: enrichedSystemPrompt,
      model,
      timeoutMs: 180_000,
    })

    const reply = result.content.slice(0, 2000)
    await message.reply(reply)

    // 会話をメモリに保存
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
