import { config } from '../config.js'
import { runClaudeCli } from '../llm/claude-cli.js'
import { createLogger } from '../utils/logger.js'
import {
  getRecentConversation,
  getConversationLineCount,
  replaceConversation,
  appendDailyLog,
  type ConversationMessage,
} from './store.js'

const log = createLogger('memory-compaction')

const COMPACTION_PROMPT = `以下の会話履歴を簡潔に要約してください。
重要な情報（決定事項、ユーザーの好み、技術的な議論のポイント）を保持し、
それ以外は省略してください。要約は日本語で、箇条書きで返してください。
会話が特に重要な内容を含まない場合は「特筆すべき内容なし」と返してください。

会話履歴:
`

/**
 * 会話履歴がしきい値を超えた場合、古いメッセージを要約して圧縮する。
 *
 * OpenClawのコンパクションと同じ思想:
 * 1. 重要情報を日次ログに退避
 * 2. 古いメッセージ群を要約で置換
 * 3. 直近メッセージはそのまま保持
 */
export async function compactConversationIfNeeded(
  guildId: string,
  channelId: string,
): Promise<boolean> {
  const lineCount = getConversationLineCount(guildId, channelId)
  const threshold = config.memory.compaction.threshold

  if (lineCount <= threshold) return false

  log.info(`Compaction triggered for ${guildId}/${channelId} (${lineCount} messages, threshold=${threshold})`)

  try {
    await compactConversation(guildId, channelId)
    return true
  } catch (err) {
    log.error(`Compaction failed for ${guildId}/${channelId}`, err)
    return false
  }
}

async function compactConversation(
  guildId: string,
  channelId: string,
): Promise<void> {
  const allMessages = getRecentConversation(guildId, channelId, 99999)

  // 直近のメッセージは保持（最新20件）
  const keepCount = 20
  const toSummarize = allMessages.slice(0, -keepCount)
  const toKeep = allMessages.slice(-keepCount)

  if (toSummarize.length === 0) return

  // 要約対象の会話をテキスト化
  const conversationText = toSummarize
    .map((m) => {
      const name = m.username ?? m.role
      return `${name}: ${m.content}`
    })
    .join('\n')

  // Claude CLI で要約を生成
  const result = await runClaudeCli({
    prompt: COMPACTION_PROMPT + conversationText,
    model: config.memory.compaction.model,
    timeoutMs: 60_000,
  })

  const summary = result.content.trim()

  if (summary && summary !== '特筆すべき内容なし') {
    // 日次ログに要約を保存（記憶の退避）
    appendDailyLog(guildId, `## 会話要約 (${channelId})\n\n${summary}`)
    log.info(`Saved compaction summary to daily log for ${guildId}`)
  }

  // 要約メッセージ + 直近メッセージで会話ファイルを置換
  const summaryMessage: ConversationMessage = {
    role: 'assistant',
    content: `[会話要約] ${summary}`,
    timestamp: new Date().toISOString(),
  }

  const newMessages = [summaryMessage, ...toKeep]
  replaceConversation(guildId, channelId, newMessages)

  log.info(
    `Compacted ${toSummarize.length} messages → 1 summary + ${toKeep.length} recent messages`,
  )
}
