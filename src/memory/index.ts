import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'
import { appendConversation, type ConversationMessage } from './store.js'
import { initDatabase, indexMemoryFiles, cleanupStaleIndexes, closeDatabase } from './indexer.js'
import { buildMemoryContext } from './context-builder.js'
import { compactConversationIfNeeded } from './compaction.js'

const log = createLogger('memory')

export type { ConversationMessage } from './store.js'
export { readMemory, writeMemory, appendDailyLog } from './store.js'
export {
  appendSessionMessage,
  getSessionConversation,
  deleteSession,
} from './store.js'
export { searchMemory, type SearchResult } from './search.js'

let initialized = false

/**
 * メモリシステムを初期化する。
 * Bot起動時に1回呼び出す。
 */
export async function initializeMemory(): Promise<void> {
  if (!config.memory.enabled) {
    log.info('Memory system is disabled')
    return
  }

  if (initialized) return

  log.info('Initializing memory system...')

  // SQLite DB を初期化
  initDatabase()

  // 既存のメモリファイルをインデックス化
  const result = await indexMemoryFiles()
  log.info(`Initial indexing complete: ${result.indexed} indexed, ${result.skipped} skipped`)

  // 存在しないファイルのインデックスをクリーンアップ
  cleanupStaleIndexes()

  initialized = true
  log.info('Memory system initialized')
}

/**
 * メモリコンテキストを取得する（ギルドチャット用）。
 * システムプロンプトに注入する文字列を返す。
 */
export async function getMemoryContext(
  guildId: string,
  channelId: string,
  query: string,
): Promise<string> {
  if (!config.memory.enabled) return ''

  try {
    return await buildMemoryContext(guildId, channelId, query)
  } catch (err) {
    log.error('Failed to build memory context', err)
    return ''
  }
}

/**
 * 会話を保存する（ギルドチャット応答後）。
 * コンパクションの必要性もチェックする。
 */
export async function saveConversation(
  guildId: string,
  channelId: string,
  messages: ConversationMessage[],
): Promise<void> {
  if (!config.memory.enabled) return

  try {
    for (const msg of messages) {
      appendConversation(guildId, channelId, msg)
    }

    // コンパクションチェック（非同期、失敗しても無視）
    compactConversationIfNeeded(guildId, channelId).catch((err) => {
      log.warn(`Compaction check failed (non-critical): ${err}`)
    })
  } catch (err) {
    log.error('Failed to save conversation', err)
  }
}

/**
 * メモリを再インデックスする（手動/定期実行用）。
 */
export async function reindexMemory(): Promise<{ indexed: number; skipped: number }> {
  if (!config.memory.enabled) return { indexed: 0, skipped: 0 }

  cleanupStaleIndexes()
  return indexMemoryFiles()
}

/**
 * メモリシステムをシャットダウンする。
 */
export function shutdownMemory(): void {
  closeDatabase()
  initialized = false
  log.info('Memory system shut down')
}
