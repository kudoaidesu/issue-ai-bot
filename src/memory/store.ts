import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('memory-store')

export interface ConversationMessage {
  role: 'user' | 'assistant'
  userId?: string
  username?: string
  content: string
  timestamp: string
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function memoryDir(guildId: string): string {
  return join(config.memory.dataDir, 'memory', guildId)
}

function conversationDir(guildId: string): string {
  return join(config.memory.dataDir, 'conversations', guildId)
}

function todayDateStr(): string {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10)
}

function yesterdayDateStr(): string {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10)
}

// --- 永続知識 (MEMORY.md) ---

export function readMemory(guildId: string): string {
  const filePath = join(memoryDir(guildId), 'MEMORY.md')
  if (!existsSync(filePath)) return ''
  return readFileSync(filePath, 'utf-8')
}

export function writeMemory(guildId: string, content: string): void {
  const filePath = join(memoryDir(guildId), 'MEMORY.md')
  ensureDir(filePath)
  writeFileSync(filePath, content, 'utf-8')
  log.info(`Updated MEMORY.md for guild ${guildId}`)
}

// --- 日次ログ (YYYY-MM-DD.md) ---

export function appendDailyLog(guildId: string, entry: string): void {
  const dateStr = todayDateStr()
  const filePath = join(memoryDir(guildId), `${dateStr}.md`)
  ensureDir(filePath)

  const prefix = existsSync(filePath) ? '\n' : `# ${dateStr}\n\n`
  appendFileSync(filePath, prefix + entry + '\n', 'utf-8')
}

export function readDailyLog(guildId: string, dateStr: string): string {
  const filePath = join(memoryDir(guildId), `${dateStr}.md`)
  if (!existsSync(filePath)) return ''
  return readFileSync(filePath, 'utf-8')
}

export function readTodayAndYesterdayLogs(guildId: string): string {
  const today = readDailyLog(guildId, todayDateStr())
  const yesterday = readDailyLog(guildId, yesterdayDateStr())

  const parts: string[] = []
  if (yesterday) parts.push(yesterday)
  if (today) parts.push(today)
  return parts.join('\n\n---\n\n')
}

// --- 会話履歴 (JSONL per channel) ---

function conversationFilePath(guildId: string, channelId: string): string {
  return join(conversationDir(guildId), `${channelId}.jsonl`)
}

export function appendConversation(
  guildId: string,
  channelId: string,
  msg: ConversationMessage,
): void {
  const filePath = conversationFilePath(guildId, channelId)
  ensureDir(filePath)
  appendFileSync(filePath, JSON.stringify(msg) + '\n', 'utf-8')
}

export function getRecentConversation(
  guildId: string,
  channelId: string,
  limit = 20,
): ConversationMessage[] {
  const filePath = conversationFilePath(guildId, channelId)
  if (!existsSync(filePath)) return []

  const lines = readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())

  const recent = lines.slice(-limit)
  return recent.map((line) => JSON.parse(line) as ConversationMessage)
}

export function getConversationLineCount(guildId: string, channelId: string): number {
  const filePath = conversationFilePath(guildId, channelId)
  if (!existsSync(filePath)) return 0

  const content = readFileSync(filePath, 'utf-8')
  return content.split('\n').filter((line) => line.trim()).length
}

export function replaceConversation(
  guildId: string,
  channelId: string,
  messages: ConversationMessage[],
): void {
  const filePath = conversationFilePath(guildId, channelId)
  ensureDir(filePath)
  const content = messages.map((m) => JSON.stringify(m)).join('\n') + '\n'
  writeFileSync(filePath, content, 'utf-8')
  log.info(`Replaced conversation for ${guildId}/${channelId} (${messages.length} messages)`)
}

// --- セッション会話 (Issue Refiner用) ---

function sessionDir(): string {
  return join(config.memory.dataDir, 'sessions')
}

function sessionFilePath(sessionId: string): string {
  return join(sessionDir(), `${sessionId}.jsonl`)
}

export function appendSessionMessage(sessionId: string, msg: ConversationMessage): void {
  const filePath = sessionFilePath(sessionId)
  ensureDir(filePath)
  appendFileSync(filePath, JSON.stringify(msg) + '\n', 'utf-8')
}

export function getSessionConversation(sessionId: string): ConversationMessage[] {
  const filePath = sessionFilePath(sessionId)
  if (!existsSync(filePath)) return []

  return readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as ConversationMessage)
}

export function deleteSession(sessionId: string): void {
  const filePath = sessionFilePath(sessionId)
  if (existsSync(filePath)) {
    unlinkSync(filePath)
    log.info(`Deleted session: ${sessionId}`)
  }
}

// --- メモリファイル列挙（インデクサ用） ---

export function listMemoryFiles(guildId: string): string[] {
  const dir = memoryDir(guildId)
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(dir, f))
}

export function listAllMemoryFiles(): string[] {
  const baseDir = join(config.memory.dataDir, 'memory')
  if (!existsSync(baseDir)) return []

  const files: string[] = []
  for (const guildDir of readdirSync(baseDir)) {
    const fullDir = join(baseDir, guildDir)
    try {
      const entries = readdirSync(fullDir)
      for (const entry of entries) {
        if (entry.endsWith('.md')) {
          files.push(join(fullDir, entry))
        }
      }
    } catch {
      // skip non-directories
    }
  }
  return files
}
