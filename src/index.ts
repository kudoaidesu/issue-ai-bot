import { config } from './config.js'
import { createLogger } from './utils/logger.js'
import { startBot } from './bot/index.js'
import { startScheduler, stopScheduler, setProcessHandler } from './queue/scheduler.js'
import { initializeMemory, shutdownMemory } from './memory/index.js'
import { startDashboard } from './dashboard/server.js'
import type { Server } from 'node:http'
import {
  notifyProcessingStart,
  notifyProcessingComplete,
  notifyError,
  createIssueThread,
  updateProgress,
} from './bot/notifier.js'
import { getIssue } from './github/issues.js'
import { runTaicho } from './agents/taicho/index.js'
import type { ProgressReporter } from './agents/taicho/types.js'

const log = createLogger('main')

async function main(): Promise<void> {
  log.info('Issue AI Bot starting...')
  log.info(`LLM: Claude Code / ${config.llm.model}`)
  log.info(`Projects: ${config.projects.map((p) => p.slug).join(', ') || 'none'}`)
  log.info('GitHub: gh CLI (authenticated session)')
  log.info(`Cron schedule: ${config.cron.schedule}`)

  // キュー処理ハンドラ: タイチョーが Issue を自動実装 → Draft PR 作成
  setProcessHandler(async (issueNumber: number, repository: string, _queueItemId: string) => {
    const project = config.projects.find((p) => p.repo === repository)
    if (!project) {
      log.error(`No project config found for repository: ${repository}`)
      await notifyError(`プロジェクト設定が見つかりません: ${repository}`)
      return
    }

    const issue = await getIssue(issueNumber, repository)
    log.info(`Processing Issue #${issueNumber} (${repository}): ${issue.title}`)

    // Thread 作成を試行
    const threadCtx = await createIssueThread(issueNumber, issue.title, project.channelId)

    if (!threadCtx) {
      // フォールバック: レガシー通知
      await notifyProcessingStart(issueNumber, project.channelId)
    }

    // ProgressReporter クロージャ構築
    const onProgress: ProgressReporter | undefined = threadCtx
      ? (data) => { void updateProgress(threadCtx, data) }
      : undefined

    const result = await runTaicho({ issue, project, onProgress })

    // Thread 使用時は onProgress 経由で done/failed が通知済み
    // Thread 未使用時はレガシー通知にフォールバック
    if (!threadCtx) {
      if (result.success) {
        const durationStr = result.durationMs
          ? ` (所要時間: ${Math.round(result.durationMs / 1000)}秒)`
          : ''
        await notifyProcessingComplete(
          issueNumber,
          true,
          `Draft PR 作成完了: ${result.prUrl}${durationStr}`,
          project.channelId,
        )
      } else {
        await notifyProcessingComplete(
          issueNumber,
          false,
          `タイチョー失敗: ${result.error} (試行回数: ${result.retryCount})`,
          project.channelId,
        )
      }
    }
  })

  // メモリシステム初期化
  await initializeMemory()
  log.info('Memory system initialized')

  // Discord Bot起動
  const client = await startBot()
  log.info('Discord Bot started')

  // Cronスケジューラ起動
  startScheduler()
  log.info('Cron scheduler started')

  // ダッシュボード起動
  let dashboardServer: Server | undefined
  if (config.dashboard.enabled) {
    dashboardServer = startDashboard()
  }

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    log.info('Shutting down...')
    stopScheduler()
    shutdownMemory()
    client.destroy()
    dashboardServer?.close()
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
