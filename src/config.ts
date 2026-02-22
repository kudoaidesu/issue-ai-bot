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
    schedule: optional('CRON_SCHEDULE', '0 22 * * *'),
    reportSchedule: optional('CRON_REPORT_SCHEDULE', '0 8 * * *'),
  },
  queue: {
    dataDir: optional('QUEUE_DATA_DIR', './data'),
  },
} as const

export function findProjectByGuildId(guildId: string): ProjectConfig | undefined {
  return config.projects.find((p) => p.guildId === guildId)
}
