import { type ProjectConfig } from '../config.js'
import { runClaudeSdk, type ClaudeSdkResult } from '../llm/claude-sdk.js'
import { createLogger } from '../utils/logger.js'
import { getMemoryContext, saveConversation } from '../memory/index.js'
import {
  createSession,
  updateSessionActivity,
  deleteSession,
} from '../session/index.js'

const log = createLogger('session-runner')

const BASE_SYSTEM_PROMPT = 'あなたはDiscordサーバーのアシスタントBotです。ユーザーの質問や雑談に日本語で簡潔に回答してください。2000文字以内で返してください。技術的な質問にはコード例を含めても構いません。'

/**
 * チャンネル名・トピックを含むシステムプロンプトを生成する。
 */
export function buildSystemPrompt(channelName?: string, channelTopic?: string): string {
  const parts = [BASE_SYSTEM_PROMPT]

  if (channelName || channelTopic) {
    const channelInfo = []
    if (channelName) channelInfo.push(`チャンネル名: #${channelName}`)
    if (channelTopic) channelInfo.push(`トピック: ${channelTopic}`)
    parts.push(`\n現在のチャンネル情報:\n${channelInfo.join('\n')}`)
  }

  return parts.join('')
}

/**
 * 新規セッション作成 + SDK実行。
 */
export async function createNewSessionAndRun(
  guildId: string,
  channelId: string,
  prompt: string,
  model: string,
  project: ProjectConfig,
  channelName?: string,
  channelTopic?: string,
): Promise<ClaudeSdkResult> {
  const memoryContext = await getMemoryContext(guildId, channelId, prompt)
  const systemPrompt = buildSystemPrompt(channelName, channelTopic)
  const enrichedSystemPrompt = memoryContext
    ? `${systemPrompt}\n\n${memoryContext}`
    : systemPrompt

  const result = await runClaudeSdk({
    prompt,
    systemPrompt: enrichedSystemPrompt,
    model,
    maxTurns: 3,
    cwd: project.localPath,
    settingSources: ['project'],
    permissionMode: 'bypassPermissions',
    timeoutMs: 180_000,
  })

  if (result.sessionId) {
    createSession({
      sessionId: result.sessionId,
      channelId,
      guildId,
      summary: prompt.slice(0, 200),
      model,
    })
  }

  return result
}

/**
 * 既存セッションを resume し、失敗時は新規セッションにフォールバック。
 */
export async function resumeSessionAndRun(
  sessionId: string,
  channelId: string,
  prompt: string,
  model: string,
  project: ProjectConfig,
  guildId: string,
  channelName?: string,
  channelTopic?: string,
): Promise<ClaudeSdkResult> {
  try {
    const result = await runClaudeSdk({
      prompt,
      model,
      resume: sessionId,
      maxTurns: 3,
      cwd: project.localPath,
      permissionMode: 'bypassPermissions',
      timeoutMs: 180_000,
    })
    updateSessionActivity(channelId, prompt.slice(0, 200))
    log.info(`Resumed session ${sessionId.slice(0, 12)}...`)
    return result
  } catch (err) {
    log.warn(`Session resume failed, creating new session: ${err}`)
    deleteSession(channelId)
    return createNewSessionAndRun(guildId, channelId, prompt, model, project, channelName, channelTopic)
  }
}

/**
 * SDK が 0 文字を返した場合に要約を要求する。
 */
export async function requestSummaryIfEmpty(
  result: ClaudeSdkResult,
  model: string,
  project: ProjectConfig,
): Promise<ClaudeSdkResult> {
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
      return summaryResult
    } catch (err) {
      log.warn(`Summary request failed: ${err}`)
    }
  }
  return result
}

/**
 * 会話をメモリに保存する。
 */
export async function saveToMemory(
  guildId: string,
  channelId: string,
  userId: string,
  username: string,
  userContent: string,
  assistantContent: string,
): Promise<void> {
  const now = new Date().toISOString()
  await saveConversation(guildId, channelId, [
    { role: 'user', userId, username, content: userContent, timestamp: now },
    { role: 'assistant', content: assistantContent, timestamp: now },
  ])
}

/**
 * 経過時間の日本語表記（autocomplete 表示用）。
 */
export function formatAge(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}時間前`
  const days = Math.floor(hours / 24)
  return `${days}日前`
}
