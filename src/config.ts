import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function required(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function optional(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue
}

export type ChatModel = 'haiku' | 'sonnet' | 'opus'
export const VALID_CHAT_MODELS: readonly ChatModel[] = ['haiku', 'sonnet', 'opus'] as const

/** セレクトメニュー用モデル一覧（バージョン情報付き） */
export interface ModelOption {
  id: string
  label: string
  description: string
}

/**
 * 利用可能なモデル一覧。新モデルリリース時はここを更新する。
 * 参照: https://platform.claude.com/docs/en/about-claude/models/overview
 * id は Claude CLI の `--model` に渡す値（エイリアスまたはフルID）。
 */
export const MODEL_OPTIONS: readonly ModelOption[] = [
  // --- 最新モデル（エイリアス → 常に最新バージョンを指す） ---
  { id: 'opus', label: 'Opus 4.6 (最新)', description: '最高性能・エージェント向け' },
  { id: 'sonnet', label: 'Sonnet 4.6 (最新)', description: 'バランス型・高速+高性能' },
  { id: 'haiku', label: 'Haiku 4.5 (最新)', description: '最速・低コスト・雑談向け' },
  // --- 固定バージョン ---
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', description: '旧バージョン・安定' },
  { id: 'claude-opus-4-5-20251101', label: 'Opus 4.5', description: '旧バージョン・安定' },
  { id: 'claude-opus-4-1-20250805', label: 'Opus 4.1', description: '旧バージョン' },
  { id: 'claude-sonnet-4-20250514', label: 'Sonnet 4.0', description: '旧バージョン' },
  { id: 'claude-opus-4-20250514', label: 'Opus 4.0', description: '旧バージョン' },
] as const

/** MODEL_OPTIONS の最終更新日。古くなったらBot起動時に警告する */
export const MODEL_OPTIONS_UPDATED = '2026-02-23'

export interface ProjectConfig {
  slug: string
  guildId: string
  channelId: string
  repo: string
  localPath: string
  chatModel?: ChatModel
}

function loadProjects(): ProjectConfig[] {
  const projectsPath = resolve(process.cwd(), 'projects.json')
  try {
    const raw = readFileSync(projectsPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new Error('projects.json must be an array')
    }
    const projects = parsed as ProjectConfig[]
    for (const p of projects) {
      if (p.chatModel && !VALID_CHAT_MODELS.includes(p.chatModel)) {
        throw new Error(
          `Invalid chatModel "${p.chatModel}" in projects.json for project "${p.slug}". ` +
          `Valid values: ${VALID_CHAT_MODELS.join(', ')}`,
        )
      }
    }
    return projects
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw err
  }
}

export const config = {
  discord: {
    botToken: required('DISCORD_BOT_TOKEN'),
  },
  projects: loadProjects(),
  llm: {
    model: optional('LLM_MODEL', 'sonnet'),
  },
  chat: {
    defaultModel: optional('CHAT_MODEL', 'haiku') as ChatModel,
  },
  cron: {
    schedule: optional('CRON_SCHEDULE', '0 1 * * *'),
    reportSchedule: optional('CRON_REPORT_SCHEDULE', '0 9 * * *'),
  },
  queue: {
    dataDir: optional('QUEUE_DATA_DIR', './data'),
    maxBatchSize: Number(optional('QUEUE_MAX_BATCH_SIZE', '5')),
    cooldownMs: Number(optional('QUEUE_COOLDOWN_MS', '60000')),
    dailyBudgetUsd: Number(optional('QUEUE_DAILY_BUDGET_USD', '20')),
    maxRetries: Number(optional('QUEUE_MAX_RETRIES', '2')),
    retryBaseMs: Number(optional('QUEUE_RETRY_BASE_MS', '300000')),
  },
  coder: {
    maxBudgetUsd: Number(optional('CODER_MAX_BUDGET_USD', '5')),
    maxRetries: Number(optional('CODER_MAX_RETRIES', '3')),
    timeoutMs: Number(optional('CODER_TIMEOUT_MS', String(30 * 60 * 1000))),
  },
  memory: {
    enabled: optional('MEMORY_ENABLED', 'true') === 'true',
    dataDir: optional('MEMORY_DATA_DIR', './data'),
    search: {
      vectorWeight: 0.7,
      textWeight: 0.3,
      maxResults: 6,
      minScore: 0.35,
    },
    chunking: {
      tokens: 400,
      overlap: 80,
    },
    temporalDecay: {
      enabled: true,
      halfLifeDays: 30,
    },
    compaction: {
      threshold: 100,
      model: 'haiku',
    },
    contextBudgetTokens: 2000,
  },
  usageMonitor: {
    scrapeSchedule: optional('USAGE_SCRAPE_SCHEDULE', '*/20 * * * *'),
    reportSchedule: optional('USAGE_REPORT_SCHEDULE', '0 9 * * *'),
    alertThreshold: Number(optional('USAGE_ALERT_THRESHOLD', '80')),
    chromeUserDataDir: optional(
      'USAGE_CHROME_USER_DATA_DIR',
      './data/chrome-usage-profile',
    ),
    timeoutMs: Number(optional('USAGE_MONITOR_TIMEOUT_MS', '60000')),
    claudeUsageUrl: 'https://claude.ai/settings/usage',
    codexUsageUrl: 'https://chatgpt.com/codex/settings/usage',
  },
} as const

export function findProjectByGuildId(guildId: string): ProjectConfig | undefined {
  return config.projects.find((p) => p.guildId === guildId)
}
