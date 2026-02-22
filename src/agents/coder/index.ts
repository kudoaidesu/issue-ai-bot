import { config } from '../../config.js'
import { runClaudeCli } from '../../llm/claude-cli.js'
import { addComment } from '../../github/issues.js'
import { createLogger } from '../../utils/logger.js'
import { appendAudit } from '../../utils/audit.js'
import { recordCost } from '../../utils/cost-tracker.js'
import type { CoderAgentInput, CoderAgentResult } from './types.js'
import { CODER_SYSTEM_PROMPT, buildUserPrompt } from './prompt.js'
import {
  generateBranchName,
  getBaseBranch,
  ensureCleanWorkingTree,
  createFeatureBranch,
  hasNewCommits,
  pushBranch,
  createDraftPR,
  cleanupBranch,
  resetToBase,
} from './git.js'

const log = createLogger('coder-agent')

export async function runCoderAgent(input: CoderAgentInput): Promise<CoderAgentResult> {
  const { issue, project } = input
  const startTime = Date.now()
  const maxRetries = config.coder.maxRetries

  log.info(`Starting coder agent for Issue #${issue.number} (${project.repo})`)

  appendAudit({
    action: 'coder_start',
    actor: 'coder-agent',
    detail: `Issue #${issue.number}: ${issue.title} (${project.repo})`,
    result: 'allow',
  })

  const branchName = generateBranchName(issue.number, issue.title)
  let baseBranch: string

  void input.onProgress?.({ stage: 'setup', message: 'Git セットアップ中...' })

  try {
    baseBranch = await getBaseBranch(project.localPath)
    await ensureCleanWorkingTree(project.localPath)
    await createFeatureBranch(project.localPath, branchName, baseBranch)
  } catch (err) {
    const error = `Git setup failed: ${(err as Error).message}`
    log.error(error)
    void input.onProgress?.({ stage: 'failed', message: error, error })
    return { success: false, error, retryCount: 0, durationMs: Date.now() - startTime }
  }

  let lastError = ''
  let totalCostUsd = 0

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      log.info(`Attempt ${attempt + 1}/${maxRetries} for Issue #${issue.number}`)

      void input.onProgress?.({
        stage: 'coding',
        message: `AI がコード生成中... (試行 ${attempt + 1}/${maxRetries})`,
        attempt: attempt + 1,
        maxAttempts: maxRetries,
      })

      const result = await runClaudeCli({
        prompt: buildUserPrompt(issue),
        systemPrompt: CODER_SYSTEM_PROMPT,
        model: config.llm.model,
        maxBudgetUsd: config.coder.maxBudgetUsd,
        cwd: project.localPath,
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
        timeoutMs: config.coder.timeoutMs,
        skipPermissions: true,
      })

      if (result.costUsd) {
        totalCostUsd += result.costUsd
      }

      // Claude がコミットを生成したか確認
      void input.onProgress?.({ stage: 'verifying', message: 'コミットを確認中...' })

      const hasCommits = await hasNewCommits(project.localPath, baseBranch)
      if (!hasCommits) {
        throw new Error('Claude produced no code changes')
      }

      // Push & PR 作成
      void input.onProgress?.({ stage: 'pushing', message: 'PR を作成中...' })

      await pushBranch(project.localPath, branchName)
      const prUrl = await createDraftPR(project.repo, branchName, baseBranch, issue)

      // Issue にコメント追加
      await addComment(
        issue.number,
        `AI Coder Agent が Draft PR を作成しました: ${prUrl}`,
        project.repo,
      )

      const durationMs = Date.now() - startTime

      appendAudit({
        action: 'coder_complete',
        actor: 'coder-agent',
        detail: `Issue #${issue.number}: PR ${prUrl} (cost: $${totalCostUsd.toFixed(2)}, duration: ${Math.round(durationMs / 1000)}s, attempts: ${attempt + 1})`,
        result: 'allow',
      })

      recordCost({
        issueNumber: issue.number,
        repository: project.repo,
        costUsd: totalCostUsd,
        durationMs,
        success: true,
        prUrl,
        retryCount: attempt,
      })

      log.info(`Coder agent completed for Issue #${issue.number}: ${prUrl}`)

      void input.onProgress?.({
        stage: 'done',
        message: `完了: ${prUrl}`,
        prUrl,
        costUsd: totalCostUsd,
        durationMs,
      })

      return {
        success: true,
        prUrl,
        branchName,
        costUsd: totalCostUsd,
        durationMs,
        retryCount: attempt,
      }
    } catch (err) {
      lastError = (err as Error).message
      log.warn(`Attempt ${attempt + 1}/${maxRetries} failed: ${lastError}`)

      if (attempt < maxRetries - 1) {
        // リトライ前にブランチをリセット
        void input.onProgress?.({
          stage: 'retrying',
          message: `リトライ準備中... (${attempt + 2}/${maxRetries})`,
          attempt: attempt + 2,
          maxAttempts: maxRetries,
        })

        try {
          await resetToBase(project.localPath, baseBranch)
        } catch (resetErr) {
          log.error(`Reset failed: ${(resetErr as Error).message}`)
          break
        }
      }
    }
  }

  // 全リトライ失敗
  await cleanupBranch(project.localPath, baseBranch, branchName)

  const durationMs = Date.now() - startTime
  const error = `Failed after ${maxRetries} attempts. Last error: ${lastError}`

  void input.onProgress?.({
    stage: 'failed',
    message: `失敗: ${lastError}`,
    error,
    costUsd: totalCostUsd,
    durationMs,
  })

  appendAudit({
    action: 'coder_failed',
    actor: 'coder-agent',
    detail: `Issue #${issue.number}: ${error} (cost: $${totalCostUsd.toFixed(2)}, duration: ${Math.round(durationMs / 1000)}s)`,
    result: 'error',
  })

  recordCost({
    issueNumber: issue.number,
    repository: project.repo,
    costUsd: totalCostUsd,
    durationMs,
    success: false,
    retryCount: maxRetries,
  })

  // Issue に失敗コメントを追加
  try {
    await addComment(
      issue.number,
      `AI Coder Agent が実装に失敗しました（${maxRetries}回試行）。手動での対応が必要です。\n\nエラー: ${lastError}`,
      project.repo,
    )
  } catch {
    log.warn('Failed to add failure comment to Issue')
  }

  log.error(`Coder agent failed for Issue #${issue.number}: ${error}`)

  return {
    success: false,
    error,
    costUsd: totalCostUsd,
    durationMs,
    retryCount: maxRetries,
  }
}
