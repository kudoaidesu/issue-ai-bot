import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'
import { readMemory, readTodayAndYesterdayLogs, getRecentConversation } from './store.js'
import { searchMemory } from './search.js'

const log = createLogger('memory-context')

// 1トークン ≒ 4文字の近似
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * システムプロンプトに注入するメモリコンテキストを構築する。
 *
 * 構築順序（OpenClawと同じ優先度）:
 * 1. MEMORY.md（永続知識）→ 常に含む
 * 2. 今日 + 昨日の日次ログ → 常に含む
 * 3. 直近の会話履歴（最新10件）→ 常に含む
 * 4. ハイブリッド検索結果 → トークン予算内で追加
 */
export async function buildMemoryContext(
  guildId: string,
  channelId: string,
  currentQuery: string,
): Promise<string> {
  const budgetTokens = config.memory.contextBudgetTokens
  const sections: string[] = []
  let usedTokens = 0

  // 1. 永続知識 (MEMORY.md)
  const memory = readMemory(guildId)
  if (memory) {
    const section = `## 永続知識\n${memory}`
    const tokens = estimateTokens(section)
    if (usedTokens + tokens <= budgetTokens) {
      sections.push(section)
      usedTokens += tokens
    }
  }

  // 2. 日次ログ（今日 + 昨日）
  const dailyLogs = readTodayAndYesterdayLogs(guildId)
  if (dailyLogs) {
    const section = `## 最近のメモ\n${dailyLogs}`
    const tokens = estimateTokens(section)
    if (usedTokens + tokens <= budgetTokens) {
      sections.push(section)
      usedTokens += tokens
    }
  }

  // 3. 直近の会話履歴
  const recentMessages = getRecentConversation(guildId, channelId, 10)
  if (recentMessages.length > 0) {
    const conversationText = recentMessages
      .map((m) => {
        const name = m.username ?? (m.role === 'user' ? 'ユーザー' : 'Bot')
        return `${name}: ${m.content.slice(0, 200)}`
      })
      .join('\n')

    const section = `## 直近の会話\n${conversationText}`
    const tokens = estimateTokens(section)
    if (usedTokens + tokens <= budgetTokens) {
      sections.push(section)
      usedTokens += tokens
    }
  }

  // 4. セマンティック検索結果（残りのトークン予算で）
  const remainingTokens = budgetTokens - usedTokens
  if (remainingTokens > 200 && currentQuery.length > 2) {
    try {
      const searchResults = await searchMemory(currentQuery, {
        maxResults: 3,
        guildId,
      })

      if (searchResults.length > 0) {
        const snippets = searchResults
          .map((r) => `- ${r.snippet}`)
          .join('\n')

        const section = `## 関連する記憶\n${snippets}`
        const tokens = estimateTokens(section)
        if (usedTokens + tokens <= budgetTokens) {
          sections.push(section)
          usedTokens += tokens
        }
      }
    } catch (err) {
      log.warn(`Memory search failed during context building: ${err}`)
    }
  }

  if (sections.length === 0) return ''

  const context = `# メモリコンテキスト\n以下はあなたの記憶です。会話の文脈維持に活用してください。\n\n${sections.join('\n\n')}`

  log.info(`Built memory context: ${usedTokens} tokens, ${sections.length} sections`)
  return context
}
