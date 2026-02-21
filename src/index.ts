import { config } from './config.js'
import { createLogger } from './utils/logger.js'
import { startBot } from './bot/index.js'
import { startScheduler, stopScheduler, setProcessHandler } from './queue/scheduler.js'
import { notifyProcessingStart, notifyProcessingComplete } from './bot/notifier.js'
import { getIssue } from './github/issues.js'

const log = createLogger('main')

async function main(): Promise<void> {
  log.info('Issue AI Bot starting...')
  log.info(`LLM: Claude Code (${config.llm.mode}) / ${config.llm.model}`)
  log.info('GitHub: gh CLI (authenticated session)')
  log.info(`Cron schedule: ${config.cron.schedule}`)

  // キュー処理ハンドラを設定（Phase 2で実装するAI Coderに差し替え可能）
  setProcessHandler(async (issueNumber: number) => {
    await notifyProcessingStart(issueNumber)

    const issue = await getIssue(issueNumber)
    log.info(`Processing Issue #${issueNumber}: ${issue.title}`)

    // TODO: Phase 2 — AI Coder Agentを呼び出してコード生成→PR作成
    // 現在はログ出力のみ
    log.info(`Issue #${issueNumber} — AI Coder Agent is not yet implemented`)

    await notifyProcessingComplete(issueNumber, true, 'AI Coderは未実装です。Issue情報をログに記録しました。')
  })

  // Discord Bot起動
  const client = await startBot()
  log.info('Discord Bot started')

  // Cronスケジューラ起動
  startScheduler()
  log.info('Cron scheduler started')

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    log.info('Shutting down...')
    stopScheduler()
    client.destroy()
    log.info('Goodbye')
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((err) => {
  log.error('Fatal error', err)
  process.exit(1)
})
