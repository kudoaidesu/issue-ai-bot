import { config } from '../../../config.js'
import { runClaudeCli } from '../../../llm/claude-cli.js'
import { createLogger } from '../../../utils/logger.js'
import { buildUserPrompt } from '../prompt.js'
import type { CodingStrategy, CodingContext, CodingResult } from '../types.js'

const log = createLogger('taicho-shogun')

/**
 * Shogun Strategy
 *
 * multi-agent-shogun (https://github.com/yohey-w/multi-agent-shogun) を参考にした
 * 戦国軍制ベースの3層階層構造。
 *
 * 階層:
 *   軍師 (gunshi)  — 戦略分析・最終レビュー（読み取り専用）
 *   家老 (karo)    — タスク分解・依存関係管理（計画専門）
 *   足軽 (ashigaru) — コード実装（実行専門、複数回呼び出し）
 *
 * フロー:
 *   1. 軍師: コードベースを偵察し、戦略レポートを作成
 *   2. 家老: 軍師のレポートを基にタスクを分解・優先度付け
 *   3. 足軽: 各タスクを順次実行（各自コミット）
 *   4. 軍師: 全実装のレビュー、ビルド・テスト確認
 *
 * orchestrator-workers との違い:
 *   - 分析と計画が分離（軍師 ≠ 家老）
 *   - 軍師が最初と最後の2回登場（偵察 + レビュー）
 *   - 家老は依存関係を明示的に管理
 *   - 足軽は前のタスクの結果を引き継ぐ
 */
export class ShogunStrategy implements CodingStrategy {
  readonly name = 'shogun'

  async execute(ctx: CodingContext): Promise<CodingResult> {
    // Phase 1: 軍師の偵察（コードベース分析）
    log.info(`[軍師・偵察] Issue #${ctx.issue.number} のコードベースを分析中`)
    const reconResult = await runClaudeCli({
      prompt: this.buildGunshiReconPrompt(ctx),
      systemPrompt: GUNSHI_SYSTEM_PROMPT,
      model: config.llm.model,
      cwd: ctx.project.localPath,
      allowedTools: ['Read', 'Glob', 'Grep'],
      timeoutMs: config.taicho.timeoutMs * 0.15,
      skipPermissions: true,
    })
    const reconReport = reconResult.content

    // Phase 2: 家老のタスク分解
    log.info(`[家老・分解] タスクを分解・依存関係を整理中`)
    const karoResult = await runClaudeCli({
      prompt: this.buildKaroPrompt(ctx, reconReport),
      systemPrompt: KARO_SYSTEM_PROMPT,
      model: config.llm.model,
      cwd: ctx.project.localPath,
      allowedTools: ['Read', 'Glob', 'Grep'],
      timeoutMs: config.taicho.timeoutMs * 0.1,
      skipPermissions: true,
    })

    const tasks = this.parseKaroPlan(karoResult.content)
    log.info(`[家老・分解] ${tasks.length} タスクに分解完了`)

    // Phase 3: 足軽の実行（順次）
    let previousResults: string[] = []

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]
      log.info(`[足軽${i + 1}] ${task.title} — 実行中`)

      await runClaudeCli({
        prompt: this.buildAshigaruPrompt(ctx, task, i + 1, tasks.length, previousResults),
        systemPrompt: ASHIGARU_SYSTEM_PROMPT,
        model: config.llm.model,
        cwd: ctx.project.localPath,
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
        timeoutMs: config.taicho.timeoutMs * 0.25,
        skipPermissions: true,
      })

      // 次の足軽に引き継ぐ要約
      previousResults.push(`足軽${i + 1} (${task.title}): 完了`)
    }

    // Phase 4: 軍師のレビュー（品質確認）
    log.info(`[軍師・検閲] 全実装のレビュー中`)
    await runClaudeCli({
      prompt: this.buildGunshiReviewPrompt(ctx),
      systemPrompt: GUNSHI_REVIEW_SYSTEM_PROMPT,
      model: config.llm.model,
      cwd: ctx.project.localPath,
      allowedTools: ['Bash', 'Read', 'Glob', 'Grep', 'Edit', 'Write'],
      timeoutMs: config.taicho.timeoutMs * 0.2,
      skipPermissions: true,
    })

    return {}
  }

  private buildGunshiReconPrompt(ctx: CodingContext): string {
    return `## 偵察任務

以下の Issue を実装するにあたり、コードベースを偵察せよ。

${buildUserPrompt(ctx.issue)}

## 報告内容

以下を調査し、戦略レポートとして報告せよ:

1. **関連ファイル一覧**: 変更が必要なファイルとその役割
2. **依存関係**: ファイル間の import 関係、変更の波及範囲
3. **既存パターン**: プロジェクトで使われているコーディングパターン・命名規則
4. **リスク評価**: 変更によって壊れる可能性のある箇所
5. **推奨アプローチ**: 実装の方向性と注意点

コードの変更は行うな。偵察と分析のみ。`
  }

  private buildKaroPrompt(ctx: CodingContext, reconReport: string): string {
    return `## タスク分解命令

Issue #${ctx.issue.number}: ${ctx.issue.title}

## 軍師の偵察レポート

${reconReport}

## 命令

上記レポートを基に、実装タスクを分解し、依存関係を整理せよ。

以下の JSON 形式で出力:

\`\`\`json
{
  "tasks": [
    {
      "id": 1,
      "title": "タスクの簡潔な説明",
      "files": ["対象ファイル"],
      "instructions": "具体的な実装指示",
      "depends_on": [],
      "priority": "high|medium|low"
    }
  ]
}
\`\`\`

## 分解のルール
- 各タスクは1つの論理的な変更に対応させよ
- 型定義・インターフェースの変更は最初のタスクに含めよ
- depends_on には先行タスクの id を指定せよ
- 実行順序通りに並べよ（depends_on を尊重）
- テスト・ビルド確認は含めるな（別フェーズで実施する）`
  }

  private buildAshigaruPrompt(
    ctx: CodingContext,
    task: ShogunTask,
    index: number,
    total: number,
    previousResults: string[],
  ): string {
    const prevContext = previousResults.length > 0
      ? `\n## 先行タスクの状況\n${previousResults.join('\n')}\n`
      : ''

    return `## 足軽${index}号 — 任務指示

Issue #${ctx.issue.number}: ${ctx.issue.title}

**担当タスク [${index}/${total}]**: ${task.title}
**優先度**: ${task.priority}
**対象ファイル**: ${task.files.join(', ') || '未指定'}
${prevContext}
## 実装指示

${task.instructions}

## ルール
- 割り当てられたタスクのみに集中せよ
- 変更完了後、git add && git commit せよ
- コミットメッセージ: feat: ${task.title} (#${ctx.issue.number})
- git push は行うな
- .env・認証情報には触れるな`
  }

  private buildGunshiReviewPrompt(ctx: CodingContext): string {
    return `## 検閲任務

Issue #${ctx.issue.number}: ${ctx.issue.title} の実装が完了した。
最終確認を行い、品質を保証せよ。

## 確認項目

1. **ビルド確認**: ビルドコマンドがあれば実行（npm run build 等）
2. **テスト確認**: テストコマンドがあれば実行（npm run test 等）
3. **エラー修正**: 問題があれば修正し、git commit せよ
4. **一貫性チェック**: 命名規則やコーディングスタイルが統一されているか

git push は行うな。問題がなければ何もせず完了とせよ。`
  }

  private parseKaroPlan(content: string): ShogunTask[] {
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      const jsonStr = jsonMatch ? jsonMatch[1] : content

      const objectMatch = jsonStr.match(/\{[\s\S]*\}/)
      if (!objectMatch) {
        log.warn('[家老] JSON が見つからない。単一タスクにフォールバック')
        return [this.fallbackTask()]
      }

      const parsed: unknown = JSON.parse(objectMatch[0])
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'tasks' in parsed &&
        Array.isArray((parsed as Record<string, unknown>).tasks)
      ) {
        const rawTasks = (parsed as { tasks: unknown[] }).tasks
        return rawTasks
          .filter(
            (t): t is Record<string, unknown> =>
              typeof t === 'object' &&
              t !== null &&
              'title' in t &&
              'instructions' in t,
          )
          .map((t) => ({
            id: typeof t.id === 'number' ? t.id : 0,
            title: String(t.title),
            files: Array.isArray(t.files) ? t.files.map(String) : [],
            instructions: String(t.instructions),
            dependsOn: Array.isArray(t.depends_on) ? (t.depends_on as number[]).map(Number) : [],
            priority: this.parsePriority(t),
          }))
      }
    } catch {
      log.warn('[家老] 計画のパースに失敗。単一タスクにフォールバック')
    }
    return [this.fallbackTask()]
  }

  private parsePriority(t: Record<string, unknown>): 'high' | 'medium' | 'low' {
    const p = String(t.priority ?? 'medium')
    if (p === 'high' || p === 'medium' || p === 'low') return p
    return 'medium'
  }

  private fallbackTask(): ShogunTask {
    return {
      id: 1,
      title: 'Issue 全体を実装',
      files: [],
      instructions: 'Issue の要件をすべて実装してください。',
      dependsOn: [],
      priority: 'high',
    }
  }
}

interface ShogunTask {
  id: number
  title: string
  files: string[]
  instructions: string
  dependsOn: number[]
  priority: 'high' | 'medium' | 'low'
}

// --- System Prompts ---

const GUNSHI_SYSTEM_PROMPT = `あなたは軍師（ぐんし）である。
戦場（コードベース）を偵察し、戦略を立案する参謀役だ。

## 心得
- コードの変更は一切行わない。偵察と分析のみ。
- 関連ファイルを漏れなく調査せよ
- 既存のパターンや規約を正確に把握せよ
- リスクを見逃さず報告せよ
- 報告は簡潔かつ具体的に`

const KARO_SYSTEM_PROMPT = `あなたは家老（かろう）である。
軍師の偵察レポートを基に、足軽たちへのタスク分配を取り仕切る統括役だ。

## 心得
- 自らはコードを書かない。タスクの分解と分配のみ。
- 各タスクは1つの論理的変更に対応させよ
- 依存関係を正確に把握し、実行順序を定めよ
- 足軽が迷わない明確な指示を出せ
- JSON 形式で計画を出力せよ`

const ASHIGARU_SYSTEM_PROMPT = `あなたは足軽（あしがる）である。
家老から割り当てられたタスクを黙々と実行する実行部隊だ。

## 心得
- 割り当てられたタスクのみに集中せよ
- 他のタスクの範囲には手を出すな
- 既存のコーディング規約に従え
- 変更したら git commit せよ
- git push は行うな
- .env や認証情報には触れるな`

const GUNSHI_REVIEW_SYSTEM_PROMPT = `あなたは軍師（ぐんし）である。
足軽たちの実装結果を検閲し、品質を保証する最終確認役だ。

## 心得
- ビルドとテストを実行し、エラーがあれば修正せよ
- 修正したら git commit せよ
- git push は行うな
- 不必要な変更は行うな
- 問題がなければ何もせず完了とせよ`
