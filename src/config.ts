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

export interface ProjectConfig {
  slug: string
  guildId: string
  channelId: string
  repo: string
  localPath: string
}

function loadProjects(): ProjectConfig[] {
  const projectsPath = resolve(process.cwd(), 'projects.json')
  try {
    const raw = readFileSync(projectsPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new Error('projects.json must be an array')
    }
    return parsed as ProjectConfig[]
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
