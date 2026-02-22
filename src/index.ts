import { config } from './config.js'
import { createLogger } from './utils/logger.js'
import { startBot } from './bot/index.js'
import { startScheduler, stopScheduler, setProcessHandler } from './queue/scheduler.js'
import { notifyProcessingStart, notifyProcessingComplete, notifyError } from './bot/notifier.js'
import { getIssue } from './github/issues.js'
import { runCoderAgent } from './agents/coder/index.js'

const log = createLogger('main')

async function main(): Promise<void> {
  log.info('Issue AI Bot starting...')
  log.info(`LLM: Claude Code / ${config.llm.model}`)
  log.info(`Projects: ${config.projects.map((p) => p.slug).join(', ') || 'none'}`)
  log.info('GitHub: gh CLI (authenticated session)')
  log.info(`Cron schedule: ${config.cron.schedule}`)

  // キュー処理ハンドラ: AI Coder Agent で Issue を自動実装 → Draft PR 作成
  setProcessHandler(async (issueNumber: number, repository: string) => {
    const project = config.projects.find((p) => p.repo === repository)
    if (!project) {
      log.error(`No project config found for repository: ${repository}`)
      await notifyError(`プロジェクト設定が見つかりません: ${repository}`)
      return
    }

    await notifyProcessingStart(issueNumber, project.channelId)

    const issue = await getIssue(issueNumber, repository)
    log.info(`Processing Issue #${issueNumber} (${repository}): ${issue.title}`)

    const result = await runCoderAgent({ issue, project })

    if (result.success) {
      const costStr = result.costUsd ? ` (コスト: $${result.costUsd.toFixed(2)})` : ''
      const durationStr = result.durationMs
        ? ` (所要時間: ${Math.round(result.durationMs / 1000)}秒)`
        : ''
      await notifyProcessingComplete(
        issueNumber,
        true,
        `Draft PR 作成完了: ${result.prUrl}${costStr}${durationStr}`,
        project.channelId,
      )
    } else {
      await notifyProcessingComplete(
        issueNumber,
        false,
        `AI Coder 失敗: ${result.error} (試行回数: ${result.retryCount})`,
        project.channelId,
      )
    }
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
