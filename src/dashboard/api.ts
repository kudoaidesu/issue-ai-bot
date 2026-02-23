import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../config.js'
import { getCostReport } from '../utils/cost-tracker.js'
import { getAuditLog } from '../utils/audit.js'
import type { CostReport, CostEntry } from '../utils/cost-tracker.js'
import type { AuditEntry } from '../utils/audit.js'

export interface ConversationMessage {
  role: 'user' | 'assistant'
  userId?: string
  username?: string
  content: string
  timestamp: string
}

export interface ChannelInfo {
  guildId: string
  channelId: string
  messageCount: number
  lastActivity: string | null
}

export interface ConversationResponse {
  guildId: string
  channelId: string
  messages: ConversationMessage[]
  total: number
}

const conversationsBaseDir = join(config.memory.dataDir, 'conversations')

export function listChannels(): ChannelInfo[] {
  if (!existsSync(conversationsBaseDir)) return []

  const channels: ChannelInfo[] = []

  const guildDirs = readdirSync(conversationsBaseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  for (const guildId of guildDirs) {
    const guildDir = join(conversationsBaseDir, guildId)
    const files = readdirSync(guildDir, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith('.jsonl'))

    for (const file of files) {
      const channelId = file.name.replace('.jsonl', '')
      const filePath = join(guildDir, file.name)
      const lines = readFileSync(filePath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim())

      let lastActivity: string | null = null
      if (lines.length > 0) {
        const last = lines[lines.length - 1]
        try {
          const parsed = JSON.parse(last) as ConversationMessage
          lastActivity = parsed.timestamp
        } catch {
          // parse error は無視
        }
      }

      channels.push({ guildId, channelId, messageCount: lines.length, lastActivity })
    }
  }

  return channels.sort((a, b) => {
    if (!a.lastActivity) return 1
    if (!b.lastActivity) return -1
    return b.lastActivity.localeCompare(a.lastActivity)
  })
}

export function getConversation(guildId: string, channelId: string, limit = 50): ConversationResponse {
  const filePath = join(conversationsBaseDir, guildId, `${channelId}.jsonl`)

  if (!existsSync(filePath)) {
    return { guildId, channelId, messages: [], total: 0 }
  }

  const lines = readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())

  const total = lines.length
  const tail = lines.slice(-limit)
  const messages = tail.map((line) => JSON.parse(line) as ConversationMessage)

  return { guildId, channelId, messages, total }
}

export function getCosts(): CostReport {
  return getCostReport()
}

export function getAudit(limit = 100): AuditEntry[] {
  return getAuditLog(limit)
}

export type { CostReport, CostEntry, AuditEntry }
