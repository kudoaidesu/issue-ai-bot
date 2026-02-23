import {
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type TextChannel,
  SlashCommandBuilder,
} from 'discord.js'
import { findProjectByGuildId } from '../../config.js'
import { sanitizePromptInput, validateDiscordInput } from '../../utils/sanitize.js'
import { resolveChatModel } from '../chat-model.js'
import {
  getSession,
  getSessionById,
  getSessionsByGuild,
  reassignSession,
} from '../../session/index.js'
import {
  createNewSessionAndRun,
  resumeSessionAndRun,
  requestSummaryIfEmpty,
  saveToMemory,
  formatAge,
} from '../session-runner.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('ask-command')

const NEW_SESSION_VALUE = '__new__'

export const data = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('セッションを選んでメッセージを送信')
  .addStringOption((opt) =>
    opt
      .setName('message')
      .setDescription('送信するメッセージ')
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName('session')
      .setDescription('セッションを選択（省略時: このチャンネルの現行セッション）')
      .setAutocomplete(true)
      .setRequired(false),
  )

export async function autocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const guildId = interaction.guildId
  if (!guildId) return

  const focusedValue = interaction.options.getFocused().toLowerCase()
  const channelId = interaction.channelId

  const sessions = getSessionsByGuild(guildId)
  const choices: Array<{ name: string; value: string }> = []

  // 先頭: 新規セッション
  choices.push({ name: '\u{1f195} 新規セッション', value: NEW_SESSION_VALUE })

  // このチャンネルのセッションを優先表示
  const currentSession = sessions.find((s) => s.channelId === channelId)
  if (currentSession) {
    const age = formatAge(currentSession.lastActiveAt)
    const label = `[現在] ${currentSession.summary.slice(0, 60)} (${age})`
    choices.push({ name: label, value: currentSession.sessionId })
  }

  // 他チャンネルのセッション
  for (const s of sessions) {
    if (s.channelId === channelId) continue
    const age = formatAge(s.lastActiveAt)
    const label = `${s.summary.slice(0, 70)} (${age})`
    choices.push({ name: label, value: s.sessionId })
  }

  // ユーザー入力でフィルタ
  const filtered = focusedValue
    ? choices.filter((c) => c.name.toLowerCase().includes(focusedValue))
    : choices

  // Discord の autocomplete は最大25件
  await interaction.respond(filtered.slice(0, 25))
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId
  if (!guildId) {
    await interaction.reply({ content: 'サーバー内でのみ使用できます。', ephemeral: true })
    return
  }

  const project = findProjectByGuildId(guildId)
  if (!project) {
    await interaction.reply({ content: 'このサーバーはプロジェクト未登録です。', ephemeral: true })
    return
  }

  const rawMessage = interaction.options.getString('message', true)
  const sessionOption = interaction.options.getString('session')

  const validation = validateDiscordInput(rawMessage)
  if (!validation.valid) {
    await interaction.reply({ content: '無効な入力です。', ephemeral: true })
    return
  }
  const sanitized = sanitizePromptInput(validation.sanitized)

  const model = resolveChatModel(guildId)
  const channelId = interaction.channelId

  // チャンネル名・トピック
  const channel = interaction.channel
  const channelName = channel && 'name' in channel ? (channel as TextChannel).name : undefined
  const channelTopic = channel && 'topic' in channel ? (channel as TextChannel).topic ?? undefined : undefined

  await interaction.deferReply()

  try {
    let result

    if (sessionOption === NEW_SESSION_VALUE || sessionOption === null) {
      if (sessionOption === NEW_SESSION_VALUE) {
        // 強制新規セッション
        log.info(`/ask: forced new session by ${interaction.user.tag}`)
        result = await createNewSessionAndRun(
          guildId, channelId, sanitized, model, project, channelName, channelTopic,
        )
      } else {
        // session 省略: チャンネルの現行セッションを auto-resume
        const existingSession = getSession(channelId)
        if (existingSession) {
          result = await resumeSessionAndRun(
            existingSession.sessionId, channelId, sanitized, model, project, guildId, channelName, channelTopic,
          )
        } else {
          result = await createNewSessionAndRun(
            guildId, channelId, sanitized, model, project, channelName, channelTopic,
          )
        }
      }
    } else {
      // 特定セッションを指定して resume
      const targetSession = getSessionById(sessionOption)
      if (!targetSession) {
        await interaction.editReply('指定されたセッションが見つかりません（期限切れまたはアーカイブ済み）。')
        return
      }

      // 別チャンネルのセッションなら reassign
      if (targetSession.channelId !== channelId) {
        reassignSession(sessionOption, channelId)
        log.info(`/ask: reassigned session ${sessionOption.slice(0, 12)}... to channel ${channelId}`)
      }

      result = await resumeSessionAndRun(
        sessionOption, channelId, sanitized, model, project, guildId, channelName, channelTopic,
      )
    }

    // 0文字フォールバック
    result = await requestSummaryIfEmpty(result, model, project)

    const reply = result.content.slice(0, 2000)
    await interaction.editReply(reply || '処理は完了しましたが、返答内容を取得できませんでした。')

    // メモリ保存
    await saveToMemory(guildId, channelId, interaction.user.id, interaction.user.tag, sanitized, result.content)
  } catch (err) {
    log.error('/ask command failed', err)
    await interaction.editReply('すみません、応答の生成に失敗しました。')
  }
}
