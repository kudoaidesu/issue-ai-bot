import { config } from '../../../config.js'
import { runClaudeCli } from '../../../llm/claude-cli.js'
import { createLogger } from '../../../utils/logger.js'
import { buildUserPrompt } from '../prompt.js'
import type { CodingStrategy, CodingContext, CodingResult } from '../types.js'

const log = createLogger('taicho-orchestrator-workers')

/**
 * Orchestrator-Workers Strategy
 *
 * Anthropic の「Building effective agents」で提唱されたパターン。
 * 1つのオーケストレーター LLM がタスクを分析・分解し、
 * 複数のワーカー LLM が各サブタスクを実行する。
 *
 * フロー:
 *   1. オーケストレーター: Issue を読み、実装計画を JSON で出力
 *   2. ワーカー (順次): 各サブタスクを実行し、コード変更をコミット
 *   3. オーケストレーター: 最終確認（ビルド・テスト）
 */
export class OrchestratorWorkersStrategy implements CodingStrategy {
  readonly name = 'orchestrator-workers'

  async execute(ctx: CodingContext): Promise<CodingResult> {
    let totalCost = 0

    // Phase 1: オーケストレーターがタスクを分解
    log.info(`[Phase 1] Orchestrator planning for Issue #${ctx.issue.number}`)
    const planResult = await runClaudeCli({
      prompt: this.buildPlannerPrompt(ctx),
      systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
      model: config.llm.model,
      maxBudgetUsd: config.taicho.maxBudgetUsd * 0.2, // 予算の20%を計画に
      cwd: ctx.project.localPath,
      allowedTools: ['Read', 'Glob', 'Grep'],
      timeoutMs: config.taicho.timeoutMs * 0.2,
      skipPermissions: true,
    })
    totalCost += planResult.costUsd ?? 0

    const tasks = this.parsePlan(planResult.content)
    log.info(`[Phase 1] Orchestrator planned ${tasks.length} subtasks`)

    // Phase 2: ワーカーが各タスクを順次実行
    const workerBudget = (config.taicho.maxBudgetUsd * 0.7) / Math.max(tasks.length, 1)

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]
      log.info(`[Phase 2] Worker ${i + 1}/${tasks.length}: ${task.title}`)

      const workerResult = await runClaudeCli({
        prompt: this.buildWorkerPrompt(ctx, task, i + 1, tasks.length),
        systemPrompt: WORKER_SYSTEM_PROMPT,
        model: config.llm.model,
        maxBudgetUsd: workerBudget,
        cwd: ctx.project.localPath,
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
        timeoutMs: config.taicho.timeoutMs * 0.3,
        skipPermissions: true,
      })
      totalCost += workerResult.costUsd ?? 0
    }

    // Phase 3: オーケストレーターが最終確認
    log.info(`[Phase 3] Orchestrator verifying result`)
    const verifyResult = await runClaudeCli({
      prompt: this.buildVerifyPrompt(ctx),
      systemPrompt: VERIFY_SYSTEM_PROMPT,
      model: config.llm.model,
      maxBudgetUsd: config.taicho.maxBudgetUsd * 0.1,
      cwd: ctx.project.localPath,
      allowedTools: ['Bash', 'Read', 'Glob', 'Grep'],
      timeoutMs: config.taicho.timeoutMs * 0.2,
      skipPermissions: true,
    })
    totalCost += verifyResult.costUsd ?? 0

    return { costUsd: totalCost }
  }

  private buildPlannerPrompt(ctx: CodingContext): string {
    return `以下の GitHub Issue を実装するための計画を立ててください。

${buildUserPrompt(ctx.issue)}

## 出力フォーマット

以下の JSON 形式で、サブタスクに分解してください。
各タスクは独立して実行可能なように設計してください。

\`\`\`json
{
  "tasks": [
    {
      "title": "タスクの簡潔な説明",
      "files": ["変更対象のファイルパス"],
      "instructions": "具体的な実装指示"
    }
  ]
}
\`\`\`

注意:
- タスクは実行順序を考慮して並べてください
- 各タスクは1-3ファイルの変更に収めてください
- 共通の型定義やインターフェースは最初のタスクで作成してください
- テストやビルド確認は最後のタスクとして含めないでください（別フェーズで実行します）`
  }

  private buildWorkerPrompt(
    ctx: CodingContext,
    task: SubTask,
    index: number,
    total: number,
  ): string {
    return `あなたはワーカー ${index}/${total} です。以下のサブタスクを実行してください。

## 親 Issue
Issue #${ctx.issue.number}: ${ctx.issue.title}

## あなたのサブタスク
**${task.title}**

対象ファイル: ${task.files.join(', ')}

${task.instructions}

## ルール
- 割り当てられたサブタスクのみを実行してください
- 他のサブタスクの範囲に手を出さないでください
- 変更が完了したら git add && git commit してください
- コミットメッセージ: feat: ${task.title} (#${ctx.issue.number})
- git push は行わないでください`
  }

  private buildVerifyPrompt(ctx: CodingContext): string {
    return `Issue #${ctx.issue.number} の実装が完了しました。最終確認を行ってください。

1. ビルドコマンドが存在する場合は実行してください（npm run build 等）
2. テストコマンドが存在する場合は実行してください（npm run test 等）
3. エラーがあれば修正し、修正内容を git commit してください
4. git push は行わないでください

エラーがなければ何もせず終了してください。`
  }

  private parsePlan(content: string): SubTask[] {
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      const jsonStr = jsonMatch ? jsonMatch[1] : content

      const objectMatch = jsonStr.match(/\{[\s\S]*\}/)
      if (!objectMatch) {
        log.warn('No JSON found in orchestrator response, falling back to single task')
        return [this.fallbackTask()]
      }

      const parsed: unknown = JSON.parse(objectMatch[0])
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'tasks' in parsed &&
        Array.isArray((parsed as Record<string, unknown>).tasks)
      ) {
        const tasks = (parsed as { tasks: unknown[] }).tasks
        return tasks
          .filter(
            (t): t is SubTask =>
              typeof t === 'object' &&
              t !== null &&
              'title' in t &&
              'instructions' in t,
          )
          .map((t) => ({
            title: String(t.title),
            files: Array.isArray(t.files) ? t.files.map(String) : [],
            instructions: String(t.instructions),
          }))
      }
    } catch {
      log.warn('Failed to parse orchestrator plan, falling back to single task')
    }
    return [this.fallbackTask()]
  }

  private fallbackTask(): SubTask {
    return {
      title: 'Issue 全体を実装',
      files: [],
      instructions: 'Issue の要件をすべて実装してください。',
    }
  }
}

interface SubTask {
  title: string
  files: string[]
  instructions: string
}

const ORCHESTRATOR_SYSTEM_PROMPT = `あなたはオーケストレーター（計画担当）です。
GitHub Issue を分析し、実装に必要なサブタスクに分解します。

## ルール
- コードベースを探索して、変更すべきファイルを特定してください
- 各サブタスクは独立して実行可能なように設計してください
- 依存関係がある場合は実行順序を考慮してください
- JSON 形式で計画を出力してください
- コードの変更は行わないでください（計画のみ）`

const WORKER_SYSTEM_PROMPT = `あなたはワーカー（実行担当）です。
オーケストレーターから割り当てられたサブタスクを実行します。

## ルール
- 割り当てられたサブタスクのみに集中してください
- 既存のコーディング規約に従ってください
- 変更したら git commit してください
- git push は行わないでください
- .env や認証情報には触れないでください`

const VERIFY_SYSTEM_PROMPT = `あなたは検証担当です。
実装が完了したコードの最終確認を行います。

## ルール
- ビルドとテストを実行してください
- エラーがあれば修正してください
- 修正したら git commit してください
- git push は行わないでください
- 不要な変更は行わないでください`
