import { createHash } from 'node:crypto'
import { createLogger } from '../utils/logger.js'

const log = createLogger('memory-embeddings')

let pipelineInstance: EmbeddingPipeline | null = null
let loadFailed = false

interface EmbeddingPipeline {
  (text: string, options: { pooling: string; normalize: boolean }): Promise<{ data: Float32Array }>
}

/**
 * Transformers.js の埋め込みパイプラインを遅延初期化する。
 * MacBook 2018 (Intel) でも動作する all-MiniLM-L6-v2 (384次元, ~80MB) を使用。
 *
 * グレースフルデグラデーション: ロード失敗時は null を返し、BM25フォールバックになる。
 */
async function loadPipeline(): Promise<EmbeddingPipeline | null> {
  if (loadFailed) return null
  if (pipelineInstance) return pipelineInstance

  try {
    log.info('Loading embedding model (all-MiniLM-L6-v2)...')
    const { pipeline } = await import('@huggingface/transformers')
    const pipe = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { dtype: 'q8' as never },
    )
    pipelineInstance = pipe as unknown as EmbeddingPipeline
    log.info('Embedding model loaded successfully')
    return pipelineInstance
  } catch (err) {
    log.warn(`Failed to load embedding model, falling back to BM25-only search: ${err}`)
    loadFailed = true
    return null
  }
}

/**
 * テキストの埋め込みベクトルを取得する。
 * モデル未ロード時は null を返す（BM25フォールバック）。
 */
export async function getEmbedding(text: string): Promise<Float32Array | null> {
  const pipe = await loadPipeline()
  if (!pipe) return null

  try {
    const output = await pipe(text, { pooling: 'mean', normalize: true })
    return new Float32Array(output.data)
  } catch (err) {
    log.warn(`Embedding generation failed: ${err}`)
    return null
  }
}

/**
 * 複数テキストの埋め込みベクトルをバッチ取得する。
 */
export async function getEmbeddings(texts: string[]): Promise<(Float32Array | null)[]> {
  const pipe = await loadPipeline()
  if (!pipe) return texts.map(() => null)

  const results: (Float32Array | null)[] = []
  for (const text of texts) {
    try {
      const output = await pipe(text, { pooling: 'mean', normalize: true })
      results.push(new Float32Array(output.data))
    } catch {
      results.push(null)
    }
  }
  return results
}

/**
 * テキストのSHA-256ハッシュを返す（キャッシュキー用）。
 */
export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** 埋め込みモデルが利用可能かどうか */
export function isEmbeddingAvailable(): boolean {
  return pipelineInstance !== null && !loadFailed
}

/** 埋め込み次元数 */
export const EMBEDDING_DIMS = 384
