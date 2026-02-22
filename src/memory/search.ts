import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'
import { getDatabase, isVectorSearchAvailable } from './indexer.js'
import { getEmbedding } from './embeddings.js'
import { applyTemporalDecay, getAgeInDays, isEvergreenPath } from './temporal-decay.js'

const log = createLogger('memory-search')

export interface SearchResult {
  path: string
  startLine: number
  endLine: number
  snippet: string
  score: number
}

interface ChunkRow {
  id: string
  path: string
  start_line: number
  end_line: number
  text: string
}

const SNIPPET_MAX_CHARS = 700

function truncateSnippet(text: string): string {
  if (text.length <= SNIPPET_MAX_CHARS) return text
  // UTF-16安全な切り詰め
  const truncated = text.slice(0, SNIPPET_MAX_CHARS)
  return truncated + '...'
}

/**
 * FTS5のBM25キーワード検索を実行する。
 */
function searchBM25(
  query: string,
  limit: number,
): Array<{ id: string; score: number }> {
  const db = getDatabase()

  // クエリをトークン化して AND 結合
  const tokens = query.match(/[\p{L}\p{N}_]+/gu)
  if (!tokens || tokens.length === 0) return []

  const ftsQuery = tokens
    .map((t) => `"${t.replaceAll('"', '')}"`)
    .join(' AND ')

  try {
    const rows = db.prepare(`
      SELECT id, rank
      FROM chunks_fts
      WHERE chunks_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as Array<{ id: string; rank: number }>

    // BM25 rank を 0..1 スコアに変換（rank が低いほど良い）
    return rows.map((row) => ({
      id: row.id,
      score: bm25RankToScore(row.rank),
    }))
  } catch (err) {
    log.warn(`BM25 search failed: ${err}`)
    return []
  }
}

function bm25RankToScore(rank: number): number {
  const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 999
  return 1 / (1 + normalized)
}

/**
 * sqlite-vec のベクトル類似度検索を実行する。
 */
async function searchVector(
  query: string,
  limit: number,
): Promise<Array<{ id: string; score: number }>> {
  if (!isVectorSearchAvailable()) return []

  const queryEmbedding = await getEmbedding(query)
  if (!queryEmbedding) return []

  const db = getDatabase()
  const queryBuffer = Buffer.from(queryEmbedding.buffer)

  try {
    const rows = db.prepare(`
      SELECT chunk_id, distance
      FROM chunks_vec
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `).all(queryBuffer, limit) as Array<{ chunk_id: string; distance: number }>

    // cosine distance → similarity score (1 - distance)
    return rows.map((row) => ({
      id: row.chunk_id,
      score: Math.max(0, 1 - row.distance),
    }))
  } catch (err) {
    log.warn(`Vector search failed: ${err}`)
    return []
  }
}

/**
 * ハイブリッド検索: ベクトル類似度(70%) + BM25キーワード(30%)。
 * OpenClawと同じスコアマージアルゴリズム。
 *
 * グレースフルデグラデーション:
 * - ベクトル検索不可 → BM25のみ（textWeight=1.0）
 * - FTS5失敗 → ベクトルのみ
 */
export async function searchMemory(
  query: string,
  options?: {
    maxResults?: number
    minScore?: number
    guildId?: string
  },
): Promise<SearchResult[]> {
  const maxResults = options?.maxResults ?? config.memory.search.maxResults
  const minScore = options?.minScore ?? config.memory.search.minScore
  const candidateLimit = maxResults * 4 // candidateMultiplier = 4x

  // 並列で両方の検索を実行
  const [bm25Results, vectorResults] = await Promise.all([
    Promise.resolve(searchBM25(query, candidateLimit)),
    searchVector(query, candidateLimit),
  ])

  // スコアをマージ
  const scoreMap = new Map<string, { vectorScore: number; textScore: number }>()

  for (const r of vectorResults) {
    const entry = scoreMap.get(r.id) ?? { vectorScore: 0, textScore: 0 }
    entry.vectorScore = r.score
    scoreMap.set(r.id, entry)
  }

  for (const r of bm25Results) {
    const entry = scoreMap.get(r.id) ?? { vectorScore: 0, textScore: 0 }
    entry.textScore = r.score
    scoreMap.set(r.id, entry)
  }

  // 重みづけスコア計算
  const vectorWeight = vectorResults.length > 0 ? config.memory.search.vectorWeight : 0
  const textWeight = vectorResults.length > 0 ? config.memory.search.textWeight : 1.0

  const db = getDatabase()
  const getChunk = db.prepare(
    'SELECT id, path, start_line, end_line, text FROM chunks WHERE id = ?',
  )

  const results: SearchResult[] = []

  for (const [id, scores] of scoreMap) {
    const combinedScore = vectorWeight * scores.vectorScore + textWeight * scores.textScore

    if (combinedScore < minScore) continue

    const chunk = getChunk.get(id) as ChunkRow | undefined
    if (!chunk) continue

    // guild フィルタ（指定された場合）
    if (options?.guildId && !chunk.path.includes(options.guildId)) continue

    // 時間減衰を適用
    let finalScore = combinedScore
    if (config.memory.temporalDecay.enabled && !isEvergreenPath(chunk.path)) {
      const ageInDays = getAgeInDays(chunk.path)
      if (ageInDays >= 0) {
        finalScore = applyTemporalDecay(
          combinedScore,
          ageInDays,
          config.memory.temporalDecay.halfLifeDays,
        )
      }
    }

    results.push({
      path: chunk.path,
      startLine: chunk.start_line,
      endLine: chunk.end_line,
      snippet: truncateSnippet(chunk.text),
      score: finalScore,
    })
  }

  // スコア降順でソートし、上位N件を返す
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, maxResults)
}
