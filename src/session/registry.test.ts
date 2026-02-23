import { describe, it, expect, beforeEach, vi } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let testDir: string

vi.mock('../config.js', () => {
  const { mkdtempSync } = require('node:fs')
  const { join } = require('node:path')
  const { tmpdir } = require('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'session-registry-test-'))
  return {
    config: {
      queue: { dataDir: dir },
      session: { ttlMs: 24 * 60 * 60 * 1000, maxPerGuild: 50 },
    },
  }
})

import {
  getSession,
  getSessionsByGuild,
  getAllSessions,
  createSession,
  updateSessionActivity,
  deleteSession,
  archiveSession,
  expireStaleSessions,
  cleanupArchived,
} from './registry.js'
import { config } from '../config.js'

describe('SessionRegistry', () => {
  beforeEach(() => {
    testDir = config.queue.dataDir
    const filePath = join(testDir, 'sessions-registry.json')
    if (existsSync(filePath)) {
      rmSync(filePath)
    }
  })

  describe('createSession', () => {
    it('should create a new session', () => {
      const entry = createSession({
        sessionId: 'test-session-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        summary: 'Test conversation',
        model: 'haiku',
      })

      expect(entry.sessionId).toBe('test-session-1')
      expect(entry.channelId).toBe('channel-1')
      expect(entry.guildId).toBe('guild-1')
      expect(entry.status).toBe('active')
      expect(entry.messageCount).toBe(1)
      expect(entry.summary).toBe('Test conversation')
    })

    it('should archive previous session for same channel', () => {
      createSession({
        sessionId: 'session-old',
        channelId: 'channel-1',
        guildId: 'guild-1',
        summary: 'Old',
        model: 'haiku',
      })

      createSession({
        sessionId: 'session-new',
        channelId: 'channel-1',
        guildId: 'guild-1',
        summary: 'New',
        model: 'haiku',
      })

      const active = getSession('channel-1')
      expect(active?.sessionId).toBe('session-new')

      const all = getAllSessions()
      const archived = all.find((s) => s.sessionId === 'session-old')
      expect(archived?.status).toBe('archived')
    })
  })

  describe('getSession', () => {
    it('should return undefined for non-existent channel', () => {
      expect(getSession('nonexistent')).toBeUndefined()
    })

    it('should return active session', () => {
      createSession({
        sessionId: 'abc',
        channelId: 'ch-1',
        guildId: 'g-1',
        summary: 'Test',
        model: 'haiku',
      })

      const session = getSession('ch-1')
      expect(session?.sessionId).toBe('abc')
    })

    it('should not return archived sessions', () => {
      createSession({
        sessionId: 'abc',
        channelId: 'ch-1',
        guildId: 'g-1',
        summary: 'Test',
        model: 'haiku',
      })
      archiveSession('ch-1')

      expect(getSession('ch-1')).toBeUndefined()
    })
  })

  describe('getSessionsByGuild', () => {
    it('should filter by guild', () => {
      createSession({ sessionId: 's1', channelId: 'c1', guildId: 'g1', summary: 'A', model: 'haiku' })
      createSession({ sessionId: 's2', channelId: 'c2', guildId: 'g2', summary: 'B', model: 'haiku' })
      createSession({ sessionId: 's3', channelId: 'c3', guildId: 'g1', summary: 'C', model: 'haiku' })

      const guild1Sessions = getSessionsByGuild('g1')
      expect(guild1Sessions).toHaveLength(2)
      expect(guild1Sessions.map((s) => s.sessionId)).toContain('s1')
      expect(guild1Sessions.map((s) => s.sessionId)).toContain('s3')
    })
  })

  describe('updateSessionActivity', () => {
    it('should increment message count and update timestamp', () => {
      createSession({
        sessionId: 'abc',
        channelId: 'ch-1',
        guildId: 'g-1',
        summary: 'Initial',
        model: 'haiku',
      })

      updateSessionActivity('ch-1', 'Updated summary')

      const session = getSession('ch-1')
      expect(session?.messageCount).toBe(2)
      expect(session?.summary).toBe('Updated summary')
    })

    it('should do nothing for non-existent channel', () => {
      // Should not throw
      updateSessionActivity('nonexistent')
    })
  })

  describe('deleteSession', () => {
    it('should remove active session', () => {
      createSession({
        sessionId: 'abc',
        channelId: 'ch-1',
        guildId: 'g-1',
        summary: 'Test',
        model: 'haiku',
      })

      deleteSession('ch-1')
      expect(getSession('ch-1')).toBeUndefined()
    })
  })

  describe('expireStaleSessions', () => {
    it('should archive sessions older than TTL', async () => {
      createSession({
        sessionId: 'old-session',
        channelId: 'ch-1',
        guildId: 'g-1',
        summary: 'Old',
        model: 'haiku',
      })

      // 0ms TTL — 作成直後でも期限切れとなる
      await new Promise((r) => setTimeout(r, 10))
      const expired = expireStaleSessions(0)
      expect(expired).toBe(1)
      expect(getSession('ch-1')).toBeUndefined()
    })

    it('should not archive recent sessions', () => {
      createSession({
        sessionId: 'new-session',
        channelId: 'ch-1',
        guildId: 'g-1',
        summary: 'New',
        model: 'haiku',
      })

      const expired = expireStaleSessions(24 * 60 * 60 * 1000)
      expect(expired).toBe(0)
      expect(getSession('ch-1')).toBeDefined()
    })
  })

  describe('cleanupArchived', () => {
    it('should remove archived sessions from storage', () => {
      createSession({ sessionId: 's1', channelId: 'c1', guildId: 'g1', summary: 'A', model: 'haiku' })
      createSession({ sessionId: 's2', channelId: 'c2', guildId: 'g1', summary: 'B', model: 'haiku' })
      archiveSession('c1')

      const removed = cleanupArchived()
      expect(removed).toBe(1)
      expect(getAllSessions()).toHaveLength(1)
    })
  })

  describe('persistence', () => {
    it('should persist across load cycles', () => {
      createSession({
        sessionId: 'persistent',
        channelId: 'ch-1',
        guildId: 'g-1',
        summary: 'Persisted',
        model: 'haiku',
      })

      // JSON ファイルが存在することを確認
      const filePath = join(config.queue.dataDir, 'sessions-registry.json')
      expect(existsSync(filePath)).toBe(true)

      // 再度読み込み（同じ関数を使用 = ファイルから再読み込み）
      const session = getSession('ch-1')
      expect(session?.sessionId).toBe('persistent')
      expect(session?.summary).toBe('Persisted')
    })
  })
})
