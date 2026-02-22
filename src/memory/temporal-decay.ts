import { basename } from 'node:path'
import { statSync } from 'node:fs'

const DATE_PATTERN = /(\d{4})-(\d{2})-(\d{2})\.md$/

/**
 * 指数減衰を適用する。
 * score * e^(-lambda * ageInDays), lambda = ln(2) / halfLifeDays
 *
 * OpenClawと同じ実装: 30日半減期がデフォルト。
 */
export function applyTemporalDecay(
  score: number,
  ageInDays: number,
  halfLifeDays = 30,
): number {
  if (halfLifeDays <= 0) return score
  const lambda = Math.LN2 / halfLifeDays
  const clampedAge = Math.max(0, ageInDays)
  return score * Math.exp(-lambda * clampedAge)
}

/**
 * ファイルパスから日付を抽出し、現在からの経過日数を返す。
 * MEMORY.md や非日付ファイルは evergreen（減衰なし）として -1 を返す。
 */
export function getAgeInDays(filePath: string): number {
  // evergreen判定
  if (isEvergreenPath(filePath)) return -1

  // ファイル名から日付を抽出
  const match = basename(filePath).match(DATE_PATTERN)
  if (match) {
    const fileDate = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+09:00`)
    const now = new Date()
    const diffMs = now.getTime() - fileDate.getTime()
    return Math.max(0, diffMs / (24 * 60 * 60 * 1000))
  }

  // フォールバック: ファイルのmtimeを使用
  try {
    const stat = statSync(filePath)
    const diffMs = Date.now() - stat.mtimeMs
    return Math.max(0, diffMs / (24 * 60 * 60 * 1000))
  } catch {
    return 0
  }
}

/**
 * MEMORY.md や非日付ファイルは evergreen（時間減衰をスキップ）。
 */
export function isEvergreenPath(filePath: string): boolean {
  const name = basename(filePath)
  if (name === 'MEMORY.md') return true
  // 日付パターンに一致しない .md ファイルも evergreen
  return name.endsWith('.md') && !DATE_PATTERN.test(name)
}
