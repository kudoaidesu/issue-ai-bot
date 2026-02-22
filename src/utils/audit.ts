import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { config } from '../config.js'

export interface AuditEntry {
  timestamp: string
  action: string
  actor: string
  detail: string
  result: 'allow' | 'block' | 'error'
}

const auditFilePath = join(config.queue.dataDir, 'audit.jsonl')

function ensureDir(): void {
  const dir = dirname(auditFilePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function appendAudit(entry: Omit<AuditEntry, 'timestamp'>): void {
  ensureDir()
  const full: AuditEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  }
  appendFileSync(auditFilePath, JSON.stringify(full) + '\n', 'utf-8')
}

export function getAuditLog(limit = 100): AuditEntry[] {
  if (!existsSync(auditFilePath)) return []

  const lines = readFileSync(auditFilePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())

  const entries = lines.map((line) => JSON.parse(line) as AuditEntry)

  return entries.slice(-limit)
}
