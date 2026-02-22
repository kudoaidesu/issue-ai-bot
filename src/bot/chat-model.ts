import { config, findProjectByGuildId, MODEL_OPTIONS, MODEL_OPTIONS_UPDATED, type ModelOption } from '../config.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('chat-model')

/** モデルリストの鮮度チェック閾値（日数） */
const STALE_THRESHOLD_DAYS = 60

/** ランタイムオーバーライド: guildId → model ID（/model で設定、Bot再起動でリセット） */
const runtimeOverrides = new Map<string, string>()

export function setRuntimeModel(guildId: string, model: string): void {
  runtimeOverrides.set(guildId, model)
  log.info(`Runtime model override set: guild=${guildId}, model=${model}`)
}

export function clearRuntimeModel(guildId: string): void {
  runtimeOverrides.delete(guildId)
  log.info(`Runtime model override cleared: guild=${guildId}`)
}

/**
 * モデル解決の優先順位:
 * 1. messageOverride（--model プレフィックス、1回限り）
 * 2. runtimeOverrides（/model、ギルド単位）
 * 3. projects.json chatModel（プロジェクト単位）
 * 4. CHAT_MODEL 環境変数（グローバル）
 * 5. フォールバック: 'haiku'
 */
export function resolveChatModel(guildId: string, messageOverride?: string): string {
  if (messageOverride) return messageOverride

  const runtime = runtimeOverrides.get(guildId)
  if (runtime) return runtime

  const project = findProjectByGuildId(guildId)
  if (project?.chatModel) return project.chatModel

  return config.chat.defaultModel
}

export interface ModelResolutionInfo {
  resolved: string
  source: 'runtime' | 'project' | 'env' | 'default'
  runtime: string | undefined
  project: string | undefined
  env: string
}

export function getModelInfo(guildId: string): ModelResolutionInfo {
  const runtime = runtimeOverrides.get(guildId)
  const project = findProjectByGuildId(guildId)?.chatModel
  const env = config.chat.defaultModel

  let resolved: string
  let source: ModelResolutionInfo['source']

  if (runtime) {
    resolved = runtime
    source = 'runtime'
  } else if (project) {
    resolved = project
    source = 'project'
  } else {
    resolved = env
    source = env !== 'haiku' ? 'env' : 'default'
  }

  return { resolved, source, runtime, project, env }
}

/**
 * モデル表示名を取得。MODEL_OPTIONS に含まれていればラベル、なければID をそのまま返す。
 */
export function getModelDisplayName(modelId: string): string {
  const option = MODEL_OPTIONS.find((o) => o.id === modelId)
  return option ? option.label : modelId
}

/**
 * メッセージ先頭の `--model <model-id>` プレフィックスをパース。
 * モデル指定があればモデルIDと残りのコンテンツを返す。
 * ショートネーム（haiku, sonnet, opus）やフルID（claude-sonnet-4-6）に対応。
 */
export function parseModelPrefix(content: string): { model: string | undefined; content: string } {
  const match = content.match(/^--model\s+(\S+)\s+/i)
  if (!match) {
    return { model: undefined, content }
  }

  const model = match[1]
  const remaining = content.slice(match[0].length).trim()

  return { model, content: remaining }
}

/**
 * モデルリストの鮮度をチェック。
 * STALE_THRESHOLD_DAYS 以上更新されていない場合に警告ログを出す。
 * Bot起動時に呼ぶ。
 */
export function checkModelListFreshness(): void {
  const updated = new Date(MODEL_OPTIONS_UPDATED)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays > STALE_THRESHOLD_DAYS) {
    log.warn(
      `MODEL_OPTIONS が ${diffDays} 日前（${MODEL_OPTIONS_UPDATED}）の情報です。` +
      `新しいモデルがリリースされている可能性があります。` +
      `config.ts の MODEL_OPTIONS を更新してください。` +
      `参照: https://platform.claude.com/docs/en/about-claude/models/overview`,
    )
  }
}

/**
 * Claude CLI に `--model list` 的な機能はないため、
 * Anthropic API の /v1/models エンドポイントからモデル一覧を取得する。
 * API Key が必要。CLI-First設計のため、あくまで補助的な機能。
 */
export async function fetchAvailableModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch models: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as { data: Array<{ id: string; display_name: string; created_at: string }> }

  return data.data
    .filter((m) => m.id.startsWith('claude-'))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((m) => ({
      id: m.id,
      label: m.display_name,
      description: m.id,
    }))
}
