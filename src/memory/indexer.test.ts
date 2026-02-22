import { describe, it, expect, afterAll, vi } from 'vitest'

vi.mock('../config.js', () => {
  const { mkdtempSync } = require('node:fs')
  const { join } = require('node:path')
  const { tmpdir } = require('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'memory-indexer-test-'))
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

// embeddings をモック（テストでは実際のモデルロードをスキップ）
vi.mock('./embeddings.js', () => {
  const { createHash } = require('node:crypto')
  return {
    getEmbedding: () => Promise.resolve(null),
    textHash: (text: string) => createHash('sha256').update(text).digest('hex'),
    EMBEDDING_DIMS: 384,
  }
})

import { chunkText, initDatabase, closeDatabase } from './indexer.js'

describe('indexer', () => {
  afterAll(() => {
    closeDatabase()
    // テスト用tmpディレクトリはOSが自動クリーンアップ
  })

  describe('chunkText', () => {
    it('should chunk short text into a single chunk', () => {
      const text = 'Hello world\nThis is a test'
      const chunks = chunkText('/test.md', text)
      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe(text)
      expect(chunks[0].startLine).toBe(1)
    })

    it('should chunk long text into multiple chunks', () => {
      // ~3000文字のテキスト（target=1600文字なので2-3チャンク）
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${'x'.repeat(30)}`)
      const text = lines.join('\n')
      const chunks = chunkText('/long.md', text)
      expect(chunks.length).toBeGreaterThan(1)
    })

    it('should produce chunks with overlap', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${'x'.repeat(30)}`)
      const text = lines.join('\n')
      const chunks = chunkText('/overlap.md', text)

      if (chunks.length >= 2) {
        // 2番目のチャンクの開始行は1番目の終了行より前（オーバーラップ）
        expect(chunks[1].startLine).toBeLessThan(chunks[0].endLine)
      }
    })

    it('should handle empty text', () => {
      const chunks = chunkText('/empty.md', '')
      expect(chunks).toHaveLength(0)
    })

    it('should assign unique IDs to chunks', () => {
      const text = Array.from({ length: 100 }, (_, i) => `Line ${i}`).join('\n')
      const chunks = chunkText('/ids.md', text)
      const ids = new Set(chunks.map((c) => c.id))
      expect(ids.size).toBe(chunks.length)
    })
  })

  describe('initDatabase', () => {
    it('should create and return a database instance', () => {
      const db = initDatabase()
      expect(db).toBeDefined()

      // テーブルが存在することを確認
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).all() as Array<{ name: string }>
      const tableNames = tables.map((t) => t.name)

      expect(tableNames).toContain('files')
      expect(tableNames).toContain('chunks')
      expect(tableNames).toContain('embedding_cache')
    })

    it('should create FTS5 virtual table', () => {
      const db = initDatabase()
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).all() as Array<{ name: string }>
      const tableNames = tables.map((t) => t.name)

      expect(tableNames).toContain('chunks_fts')
    })
  })
})
