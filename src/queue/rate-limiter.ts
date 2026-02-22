import { config } from '../config.js'
import { getDailyCost } from '../utils/cost-tracker.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('rate-limiter')

let processing = false
let processingStartedAt: number | null = null

// ロック取得タイムアウト: coder タイムアウトの2倍
const STALE_LOCK_MS = config.coder.timeoutMs * 2

export function acquireLock(): boolean {
  if (processing) {
    // スタンバイロックの検出: タイムアウト超過なら強制解放
    if (processingStartedAt && Date.now() - processingStartedAt > STALE_LOCK_MS) {
      log.warn('Stale lock detected. Force-releasing.')
      releaseLock()
    } else {
      return false
    }
  }

  processing = true
  processingStartedAt = Date.now()
  return true
}

export function releaseLock(): void {
  processing = false
  processingStartedAt = null
}

export function isLocked(): boolean {
  return processing
}

export function isDailyBudgetExceeded(): boolean {
  const dailyCost = getDailyCost()
  const exceeded = dailyCost >= config.queue.dailyBudgetUsd
  if (exceeded) {
    log.warn(`Daily budget exceeded: $${dailyCost.toFixed(2)} >= $${config.queue.dailyBudgetUsd}`)
  }
  return exceeded
}
