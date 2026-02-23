import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let tmpDir: string

vi.mock('../config.js', () => {
  const { mkdtempSync } = require('node:fs')
  const { join } = require('node:path')
  const { tmpdir } = require('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-test-'))
  return {
    config: {
      memory: { dataDir: dir },
      queue: {
        dataDir: dir,
      },
      dashboard: { enabled: true, port: 3001, host: '127.0.0.1' },
    },
  }
})

vi.mock('../utils/audit.js', () => ({
  getAuditLog: (limit: number) => [
    { timestamp: '2026-02-23T10:00:00Z', action: 'command', actor: 'user123', detail: '/issue test', result: 'allow' },
  ].slice(0, limit),
}))

import { listChannels, getConversation, getAudit } from './api.js'

describe('dashboard/api', () => {
  beforeEach(async () => {
    // config モック内の dataDir を取得するために dynamic import
    const { config } = await import('../config.js')
    tmpDir = config.memory.dataDir

    // conversations ディレクトリとサンプルデータを作成
    const convDir = join(tmpDir, 'conversations', 'guild-1')
    mkdirSync(convDir, { recursive: true })

    const msg1 = JSON.stringify({ role: 'user', userId: 'u1', username: 'alice', content: 'こんにちは', timestamp: '2026-02-23T10:00:00.000Z' })
    const msg2 = JSON.stringify({ role: 'assistant', content: 'こんにちは！', timestamp: '2026-02-23T10:00:05.000Z' })
    writeFileSync(join(convDir, 'channel-1.jsonl'), msg1 + '\n' + msg2 + '\n', 'utf-8')
  })

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe('listChannels()', () => {
    it('チャンネル一覧を返す', () => {
      const channels = listChannels()
      expect(channels).toHaveLength(1)
      expect(channels[0].guildId).toBe('guild-1')
      expect(channels[0].channelId).toBe('channel-1')
      expect(channels[0].messageCount).toBe(2)
      expect(channels[0].lastActivity).toBe('2026-02-23T10:00:05.000Z')
    })

    it('conversations ディレクトリが存在しない場合は空配列', async () => {
      // 別の dataDir を使うシナリオは直接ファイル削除で対応
      rmSync(join(tmpDir, 'conversations'), { recursive: true, force: true })
      const channels = listChannels()
      expect(channels).toEqual([])
    })
  })

  describe('getConversation()', () => {
    it('指定チャンネルの会話履歴を返す', () => {
      const result = getConversation('guild-1', 'channel-1')
      expect(result.guildId).toBe('guild-1')
      expect(result.channelId).toBe('channel-1')
      expect(result.messages).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.messages[0].role).toBe('user')
      expect(result.messages[0].content).toBe('こんにちは')
      expect(result.messages[1].role).toBe('assistant')
    })

    it('limit で件数を絞れる', () => {
      const result = getConversation('guild-1', 'channel-1', 1)
      expect(result.messages).toHaveLength(1)
      expect(result.total).toBe(2)
      expect(result.messages[0].role).toBe('assistant') // 末尾 1 件
    })

    it('存在しないチャンネルは空を返す', () => {
      const result = getConversation('guild-1', 'no-channel')
      expect(result.messages).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  describe('getAudit()', () => {
    it('監査ログを返す', () => {
      const entries = getAudit(10)
      expect(entries).toHaveLength(1)
      expect(entries[0].action).toBe('command')
      expect(entries[0].result).toBe('allow')
    })
  })
})
