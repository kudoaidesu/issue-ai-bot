import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'
import { getEmbedding, textHash, EMBEDDING_DIMS } from './embeddings.js'
import { listAllMemoryFiles } from './store.js'

const log = createLogger('memory-indexer')

let db: Database.Database | null = null
let vecAvailable = false

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  mtime INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  hash TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS embedding_cache (
  hash TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
`

const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  id UNINDEXED,
  path UNINDEXED
);
`

/**
 * SQLite データベースを初期化する。
 * sqlite-vec が利用不可でもFTS5のみで動作する（グレースフルデグラデーション）。
 */
export function initDatabase(): Database.Database {
  if (db) return db

  const dbPath = join(config.memory.dataDir, 'memory.sqlite')
  const dir = dirname(dbPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  // 基本スキーマ
  db.exec(SCHEMA)

  // FTS5
  db.exec(FTS_SCHEMA)

  // sqlite-vec（オプション）
  try {
    sqliteVec.load(db)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding FLOAT[${EMBEDDING_DIMS}]
      );
    `)
    vecAvailable = true
    log.info('sqlite-vec loaded successfully')
  } catch (err) {
    log.warn(`sqlite-vec not available, vector search disabled: ${err}`)
    vecAvailable = false
  }

  log.info(`Memory database initialized at ${dbPath}`)
  return db
}

export function getDatabase(): Database.Database {
  if (!db) return initDatabase()
  return db
}

export function isVectorSearchAvailable(): boolean {
  return vecAvailable
}

// --- チャンク化 ---

interface Chunk {
  id: string
  path: string
  startLine: number
  endLine: number
  hash: string
  text: string
}

/**
 * テキストを行単位でチャンク化する。
 * ~400トークン（≒1,600文字）ターゲット、80トークン（≒320文字）オーバーラップ。
 */
export function chunkText(filePath: string, content: string): Chunk[] {
  const lines = content.split('\n')
  const chunks: Chunk[] = []

  const targetChars = config.memory.chunking.tokens * 4
  const overlapChars = config.memory.chunking.overlap * 4

  let startLine = 0

  while (startLine < lines.length) {
    let charCount = 0
    let endLine = startLine

    // ターゲット文字数まで行を追加
    while (endLine < lines.length && charCount < targetChars) {
      charCount += lines[endLine].length + 1
      endLine++
    }

    const chunkLines = lines.slice(startLine, endLine)
    const text = chunkLines.join('\n').trim()

    if (text) {
      const id = createHash('sha256')
        .update(`${filePath}:${startLine}`)
        .digest('hex')
        .slice(0, 16)

      chunks.push({
        id,
        path: filePath,
        startLine: startLine + 1,
        endLine,
        hash: textHash(text),
        text,
      })
    }

    // オーバーラップ分だけ戻る
    let overlapCount = 0
    let newStart = endLine
    while (newStart > startLine && overlapCount < overlapChars) {
      newStart--
      overlapCount += lines[newStart].length + 1
    }

    startLine = newStart === startLine ? endLine : newStart
  }

  return chunks
}

// --- インデックス更新 ---

function fileHash(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8')
  return createHash('sha256').update(content).digest('hex')
}

/**
 * 変更されたファイルだけを再インデックスする。
 * ファイルハッシュで変更検知し、変更があったファイルのチャンクを更新。
 */
export async function indexMemoryFiles(): Promise<{ indexed: number; skipped: number }> {
  const database = getDatabase()
  const files = listAllMemoryFiles()

  let indexed = 0
  let skipped = 0

  const getFile = database.prepare('SELECT hash FROM files WHERE path = ?')
  const upsertFile = database.prepare(
    'INSERT OR REPLACE INTO files (path, hash, mtime) VALUES (?, ?, ?)',
  )
  const deleteChunks = database.prepare('DELETE FROM chunks WHERE path = ?')
  const deleteFtsChunks = database.prepare('DELETE FROM chunks_fts WHERE path = ?')
  const insertChunk = database.prepare(
    'INSERT OR REPLACE INTO chunks (id, path, start_line, end_line, hash, text, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const insertFts = database.prepare(
    'INSERT INTO chunks_fts (text, id, path) VALUES (?, ?, ?)',
  )
  const getEmbeddingCache = database.prepare(
    'SELECT embedding FROM embedding_cache WHERE hash = ?',
  )
  const insertEmbeddingCache = database.prepare(
    'INSERT OR REPLACE INTO embedding_cache (hash, embedding, updated_at) VALUES (?, ?, ?)',
  )

  let insertVec: Database.Statement | null = null
  let deleteVec: Database.Statement | null = null
  if (vecAvailable) {
    insertVec = database.prepare(
      'INSERT OR REPLACE INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)',
    )
    deleteVec = database.prepare(
      'DELETE FROM chunks_vec WHERE chunk_id IN (SELECT id FROM chunks WHERE path = ?)',
    )
  }

  for (const filePath of files) {
    if (!existsSync(filePath)) continue

    const currentHash = fileHash(filePath)
    const existing = getFile.get(filePath) as { hash: string } | undefined

    if (existing?.hash === currentHash) {
      skipped++
      continue
    }

    const content = readFileSync(filePath, 'utf-8')
    const stat = statSync(filePath)
    const chunks = chunkText(filePath, content)

    const now = Date.now()

    // トランザクションで一括更新
    const transaction = database.transaction(() => {
      // 古いチャンクを削除
      if (deleteVec) deleteVec.run(filePath)
      deleteFtsChunks.run(filePath)
      deleteChunks.run(filePath)

      // ファイルメタデータを更新
      upsertFile.run(filePath, currentHash, Math.floor(stat.mtimeMs))

      // 新しいチャンクを挿入
      for (const chunk of chunks) {
        insertChunk.run(
          chunk.id, chunk.path, chunk.startLine, chunk.endLine,
          chunk.hash, chunk.text, now,
        )
        insertFts.run(chunk.text, chunk.id, chunk.path)
      }
    })
    transaction()

    // 埋め込みの生成（トランザクション外で非同期実行）
    if (vecAvailable && insertVec) {
      for (const chunk of chunks) {
        const cached = getEmbeddingCache.get(chunk.hash) as { embedding: Buffer } | undefined
        let embeddingBuffer: Buffer | null = null

        if (cached) {
          embeddingBuffer = cached.embedding
        } else {
          const embedding = await getEmbedding(chunk.text)
          if (embedding) {
            embeddingBuffer = Buffer.from(embedding.buffer)
            insertEmbeddingCache.run(chunk.hash, embeddingBuffer, now)
          }
        }

        if (embeddingBuffer) {
          insertVec.run(chunk.id, embeddingBuffer)
        }
      }
    }

    indexed++
    log.info(`Indexed: ${filePath} (${chunks.length} chunks)`)
  }

  return { indexed, skipped }
}

/**
 * 存在しなくなったファイルのインデックスをクリーンアップする。
 */
export function cleanupStaleIndexes(): number {
  const database = getDatabase()
  const allFiles = database.prepare('SELECT path FROM files').all() as { path: string }[]

  let cleaned = 0
  const deleteFile = database.prepare('DELETE FROM files WHERE path = ?')
  const deleteChunks = database.prepare('DELETE FROM chunks WHERE path = ?')
  const deleteFts = database.prepare('DELETE FROM chunks_fts WHERE path = ?')

  for (const { path } of allFiles) {
    if (!existsSync(path)) {
      if (vecAvailable) {
        database.prepare(
          'DELETE FROM chunks_vec WHERE chunk_id IN (SELECT id FROM chunks WHERE path = ?)',
        ).run(path)
      }
      deleteFts.run(path)
      deleteChunks.run(path)
      deleteFile.run(path)
      cleaned++
    }
  }

  if (cleaned > 0) {
    log.info(`Cleaned up ${cleaned} stale file indexes`)
  }
  return cleaned
}

/** データベースを閉じる */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
    log.info('Memory database closed')
  }
}
