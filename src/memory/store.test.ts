import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// vi.mock はホイスティングされるため、ファクトリ内で直接tmpdir作成する
vi.mock('../config.js', () => {
  const { mkdtempSync } = require('node:fs')
  const { join } = require('node:path')
  const { tmpdir } = require('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'memory-store-test-'))
  return {
    config: {
      memory: {
        enabled: true,
        dataDir: dir,
        search: { vectorWeight: 0.7, textWeight: 0.3, maxResults: 6, minScore: 0.35 },
        chunking: { tokens: 400, overlap: 80 },
        temporalDecay: { enabled: true, halfLifeDays: 30 },
        compaction: { threshold: 100, model: 'haiku' },
        contextBudgetTokens: 2000,
      },
    },
  }
})

import {
  readMemory,
  writeMemory,
  appendDailyLog,
  readDailyLog,
  appendConversation,
  getRecentConversation,
  getConversationLineCount,
  replaceConversation,
  appendSessionMessage,
  getSessionConversation,
  deleteSession,
  listMemoryFiles,
  type ConversationMessage,
} from './store.js'

describe('store', () => {
  const guildId = 'test-guild-123'
  const channelId = 'test-channel-456'

  afterEach(() => {
    // テストディレクトリはスイート全体で再利用
  })

  describe('MEMORY.md (永続知識)', () => {
    it('should return empty string when no MEMORY.md exists', () => {
      expect(readMemory('nonexistent-guild')).toBe('')
    })

    it('should write and read MEMORY.md', () => {
      writeMemory(guildId, '# 永続知識\n- ユーザーはTypeScriptを好む')
      const content = readMemory(guildId)
      expect(content).toContain('永続知識')
      expect(content).toContain('TypeScript')
    })

    it('should overwrite MEMORY.md on subsequent writes', () => {
      writeMemory(guildId, 'version 1')
      writeMemory(guildId, 'version 2')
      expect(readMemory(guildId)).toBe('version 2')
    })
  })

  describe('日次ログ (YYYY-MM-DD.md)', () => {
    it('should append to daily log', () => {
      const today = new Date()
      const jst = new Date(today.getTime() + 9 * 60 * 60 * 1000)
      const dateStr = jst.toISOString().slice(0, 10)

      appendDailyLog(guildId, 'テスト記録1')
      appendDailyLog(guildId, 'テスト記録2')

      const log = readDailyLog(guildId, dateStr)
      expect(log).toContain('テスト記録1')
      expect(log).toContain('テスト記録2')
    })

    it('should return empty string for non-existent date', () => {
      expect(readDailyLog(guildId, '2020-01-01')).toBe('')
    })
  })

  describe('会話履歴 (JSONL)', () => {
    it('should append and retrieve conversation messages', () => {
      const msg: ConversationMessage = {
        role: 'user',
        userId: 'user-1',
        username: 'testuser',
        content: 'こんにちは',
        timestamp: new Date().toISOString(),
      }

      appendConversation(guildId, channelId, msg)
      const recent = getRecentConversation(guildId, channelId)
      expect(recent.length).toBeGreaterThanOrEqual(1)

      const lastMsg = recent[recent.length - 1]
      expect(lastMsg.content).toBe('こんにちは')
      expect(lastMsg.role).toBe('user')
    })

    it('should respect limit parameter', () => {
      // 5件追加
      for (let i = 0; i < 5; i++) {
        appendConversation(guildId, `limit-test-ch`, {
          role: 'user',
          content: `message ${i}`,
          timestamp: new Date().toISOString(),
        })
      }

      const limited = getRecentConversation(guildId, 'limit-test-ch', 2)
      expect(limited).toHaveLength(2)
      expect(limited[0].content).toBe('message 3')
      expect(limited[1].content).toBe('message 4')
    })

    it('should count conversation lines', () => {
      const count = getConversationLineCount(guildId, channelId)
      expect(count).toBeGreaterThan(0)
    })

    it('should return 0 for non-existent conversation', () => {
      expect(getConversationLineCount('no-guild', 'no-channel')).toBe(0)
    })

    it('should replace conversation', () => {
      const newMessages: ConversationMessage[] = [
        { role: 'assistant', content: '要約', timestamp: new Date().toISOString() },
        { role: 'user', content: '最新メッセージ', timestamp: new Date().toISOString() },
      ]

      replaceConversation(guildId, 'replace-test-ch', newMessages)
      const result = getRecentConversation(guildId, 'replace-test-ch')
      expect(result).toHaveLength(2)
      expect(result[0].content).toBe('要約')
      expect(result[1].content).toBe('最新メッセージ')
    })
  })

  describe('セッション会話 (Issue Refiner用)', () => {
    const sessionId = 'test-session-abc'

    it('should append and retrieve session messages', () => {
      appendSessionMessage(sessionId, {
        role: 'user',
        content: 'バグを修正して',
        timestamp: new Date().toISOString(),
      })
      appendSessionMessage(sessionId, {
        role: 'assistant',
        content: 'どのファイルですか？',
        timestamp: new Date().toISOString(),
      })

      const history = getSessionConversation(sessionId)
      expect(history).toHaveLength(2)
      expect(history[0].content).toBe('バグを修正して')
      expect(history[1].role).toBe('assistant')
    })

    it('should delete session', () => {
      deleteSession(sessionId)
      const history = getSessionConversation(sessionId)
      expect(history).toHaveLength(0)
    })
  })

  describe('メモリファイル列挙', () => {
    it('should list memory files for a guild', () => {
      // MEMORY.md と日次ログが存在するはず
      const files = listMemoryFiles(guildId)
      expect(files.length).toBeGreaterThan(0)
      expect(files.some((f) => f.endsWith('MEMORY.md'))).toBe(true)
    })

    it('should return empty array for non-existent guild', () => {
      expect(listMemoryFiles('nonexistent')).toEqual([])
    })
  })
})
