import 'dotenv/config'
import type { LlmMode } from './llm/index.js'

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

export const config = {
  discord: {
    botToken: required('DISCORD_BOT_TOKEN'),
    guildId: required('DISCORD_GUILD_ID'),
    channelId: required('DISCORD_CHANNEL_ID'),
  },
  llm: {
    mode: optional('LLM_MODE', 'cli') as LlmMode,
    model: optional('LLM_MODEL', 'sonnet'),
  },
  cron: {
    schedule: optional('CRON_SCHEDULE', '0 22 * * *'),
    reportSchedule: optional('CRON_REPORT_SCHEDULE', '0 8 * * *'),
  },
  queue: {
    dataDir: optional('QUEUE_DATA_DIR', './data'),
  },
} as const
