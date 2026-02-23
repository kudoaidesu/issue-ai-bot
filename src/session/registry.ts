import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('session-registry')

export interface SessionEntry {
  sessionId: string
  channelId: string
  guildId: string
  createdAt: string
  lastActiveAt: string
  messageCount: number
  summary: string
  model: string
  status: 'active' | 'archived'
}

interface RegistryData {
  version: 1
  sessions: SessionEntry[]
}

const registryFilePath = join(config.queue.dataDir, 'sessions-registry.json')

function ensureDir(): void {
  const dir = dirname(registryFilePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function load(): SessionEntry[] {
  ensureDir()
  if (!existsSync(registryFilePath)) {
    return []
  }
  try {
    const raw = readFileSync(registryFilePath, 'utf-8')
    const data = JSON.parse(raw) as RegistryData
    return data.sessions ?? []
  } catch (err) {
    log.warn(`Failed to load session registry, starting fresh: ${err}`)
    return []
  }
}

function save(sessions: SessionEntry[]): void {
  ensureDir()
  const data: RegistryData = { version: 1, sessions }
  writeFileSync(registryFilePath, JSON.stringify(data, null, 2), 'utf-8')
}

export function getSession(channelId: string): SessionEntry | undefined {
  const sessions = load()
  return sessions.find((s) => s.channelId === channelId && s.status === 'active')
}

export function getSessionsByGuild(guildId: string): SessionEntry[] {
  return load().filter((s) => s.guildId === guildId && s.status === 'active')
}

export function getAllSessions(): SessionEntry[] {
  return load()
}

export function createSession(entry: {
  sessionId: string
  channelId: string
  guildId: string
  summary: string
  model: string
}): SessionEntry {
  const sessions = load()

  // 同じチャンネルの既存セッションをアーカイブ
  for (const s of sessions) {
    if (s.channelId === entry.channelId && s.status === 'active') {
      s.status = 'archived'
      log.info(`Archived previous session ${s.sessionId} for channel ${s.channelId}`)
    }
  }

  const now = new Date().toISOString()
  const newEntry: SessionEntry = {
    ...entry,
    createdAt: now,
    lastActiveAt: now,
    messageCount: 1,
    status: 'active',
  }

  sessions.push(newEntry)
  save(sessions)
  log.info(`Created session ${entry.sessionId} for channel ${entry.channelId}`)
  return newEntry
}

export function updateSessionActivity(
  channelId: string,
  summary?: string,
): void {
  const sessions = load()
  const session = sessions.find(
    (s) => s.channelId === channelId && s.status === 'active',
  )
  if (!session) return

  session.lastActiveAt = new Date().toISOString()
  session.messageCount += 1
  if (summary) {
    session.summary = summary
  }
  save(sessions)
}

export function deleteSession(channelId: string): void {
  const sessions = load()
  const index = sessions.findIndex(
    (s) => s.channelId === channelId && s.status === 'active',
  )
  if (index === -1) return

  const removed = sessions[index]
  sessions.splice(index, 1)
  save(sessions)
  log.info(`Deleted session ${removed.sessionId} for channel ${channelId}`)
}

export function archiveSession(channelId: string): void {
  const sessions = load()
  const session = sessions.find(
    (s) => s.channelId === channelId && s.status === 'active',
  )
  if (!session) return

  session.status = 'archived'
  save(sessions)
  log.info(`Archived session ${session.sessionId} for channel ${channelId}`)
}

export function expireStaleSessions(ttlMs?: number): number {
  const ttl = ttlMs ?? config.session.ttlMs
  const sessions = load()
  const now = Date.now()
  let expired = 0

  for (const session of sessions) {
    if (session.status !== 'active') continue
    const lastActive = new Date(session.lastActiveAt).getTime()
    if (now - lastActive > ttl) {
      session.status = 'archived'
      expired++
      log.info(
        `Expired session ${session.sessionId} (idle ${Math.round((now - lastActive) / 3600000)}h)`,
      )
    }
  }

  if (expired > 0) {
    save(sessions)
    log.info(`Expired ${expired} stale sessions`)
  }
  return expired
}

export function cleanupArchived(): number {
  const sessions = load()
  const before = sessions.length
  const remaining = sessions.filter((s) => s.status === 'active')
  save(remaining)
  const removed = before - remaining.length
  if (removed > 0) {
    log.info(`Cleaned up ${removed} archived sessions`)
  }
  return removed
}
