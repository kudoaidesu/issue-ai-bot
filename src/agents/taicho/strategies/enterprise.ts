import { config } from '../../../config.js'
import { runClaudeCli } from '../../../llm/claude-cli.js'
import { createLogger } from '../../../utils/logger.js'
import { buildUserPrompt } from '../prompt.js'
import type { CodingStrategy, CodingContext, CodingResult } from '../types.js'

const log = createLogger('taicho-enterprise')

/**
 * Enterprise Strategy
 *
 * 企業組織を模した6層階層構造。
 * PMO→PM→Architect/Coder/Tester の役割分担で大規模 Issue に対応する。
 *
 * 階層:
 *   PMO        — Issue を解釈し、PM への構造化指示書を作成（意図翻訳）
 *   Architect  — コードベース設計分析、変更設計書を作成（設計層）
 *   PM         — 設計書を基にタスクを分解・Coder へ分配（管理層）
 *   Coder 1-N  — 各タスクを実装（実装層）
 *   Tester     — 実装結果をコードレビュー＋テスト実行（品質保証層）
 *   PM         — 最終統合確認（統合レビュー）
 *
 * フロー:
 *   1. PMO: Issue の意図を解釈し、構造化された要件定義を作成
 *   2. Architect: コードベースを分析し、変更設計書を作成
 *   3. PM: 要件定義 + 設計書からタスクを分解・優先度付け
 *   4. Coder 1-N: 各タスクを順次実行
 *   5. Tester: コードレビュー + ビルド・テスト実行 + 不備修正
 *   6. PM: 最終統合レビュー（要件充足確認）
 *
 * 他 Strategy との違い:
 *   - PMO が「ユーザーの意図」を翻訳する層がある（他にはない）
 *   - Architect が設計専門（shogun の軍師は偵察寄り）
 *   - Tester が品質保証専門（他は検証フェーズのみ）
 *   - PM が計画と最終統合の2回登場（中間管理の一貫性）
 */
export class EnterpriseStrategy implements CodingStrategy {
  readonly name = 'enterprise'

  async execute(ctx: CodingContext): Promise<CodingResult> {
    // Phase 1: PMO — Issue の意図を解釈・構造化
    log.info(`[PMO] Issue #${ctx.issue.number} の意図を解釈中`)
    const pmoResult = await runClaudeCli({
      prompt: this.buildPmoPrompt(ctx),
      systemPrompt: PMO_SYSTEM_PROMPT,
      model: config.llm.model,
      cwd: ctx.project.localPath,
      allowedTools: ['Read', 'Glob', 'Grep'],
      timeoutMs: config.taicho.timeoutMs * 0.05,
      skipPermissions: true,
    })
    const requirements = pmoResult.content
    log.info(`[PMO] 要件定義を作成完了`)

    // Phase 2: Architect — コードベース分析・変更設計
    log.info(`[Architect] コードベースを分析し、設計書を作成中`)
    const architectResult = await runClaudeCli({
      prompt: this.buildArchitectPrompt(ctx, requirements),
      systemPrompt: ARCHITECT_SYSTEM_PROMPT,
      model: config.llm.model,
      cwd: ctx.project.localPath,
      allowedTools: ['Read', 'Glob', 'Grep'],
      timeoutMs: config.taicho.timeoutMs * 0.1,
      skipPermissions: true,
    })
    const designDoc = architectResult.content
    log.info(`[Architect] 設計書を作成完了`)

    // Phase 3: PM — タスク分解・優先度付け
    log.info(`[PM] タスクを分解・スケジュール作成中`)
    const pmPlanResult = await runClaudeCli({
      prompt: this.buildPmPlanPrompt(ctx, requirements, designDoc),
      systemPrompt: PM_SYSTEM_PROMPT,
      model: config.llm.model,
      cwd: ctx.project.localPath,
      allowedTools: ['Read', 'Glob', 'Grep'],
      timeoutMs: config.taicho.timeoutMs * 0.1,
      skipPermissions: true,
    })

    const tasks = this.parsePmPlan(pmPlanResult.content)
    log.info(`[PM] ${tasks.length} タスクに分解完了`)

    // Phase 4: Coder 1-N — 各タスクを順次実装
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]
      log.info(`[Coder${i + 1}] ${task.title} — 実装中`)

      await runClaudeCli({
        prompt: this.buildCoderPrompt(ctx, task, i + 1, tasks.length, designDoc),
        systemPrompt: CODER_SYSTEM_PROMPT,
        model: config.llm.model,
        cwd: ctx.project.localPath,
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
        timeoutMs: config.taicho.timeoutMs * 0.4 / Math.max(tasks.length, 1),
        skipPermissions: true,
      })
      log.info(`[Coder${i + 1}] ${task.title} — 完了`)
    }

    // Phase 5: Tester — コードレビュー + テスト実行
    log.info(`[Tester] コードレビュー・テスト実行中`)
    await runClaudeCli({
      prompt: this.buildTesterPrompt(ctx, requirements),
      systemPrompt: TESTER_SYSTEM_PROMPT,
      model: config.llm.model,
      cwd: ctx.project.localPath,
      allowedTools: ['Bash', 'Read', 'Glob', 'Grep', 'Edit', 'Write'],
      timeoutMs: config.taicho.timeoutMs * 0.2,
      skipPermissions: true,
    })
    log.info(`[Tester] テスト完了`)

    // Phase 6: PM — 最終統合レビュー
    log.info(`[PM] 最終統合レビュー中`)
    await runClaudeCli({
      prompt: this.buildPmReviewPrompt(ctx, requirements),
      systemPrompt: PM_REVIEW_SYSTEM_PROMPT,
      model: config.llm.model,
      cwd: ctx.project.localPath,
      allowedTools: ['Bash', 'Read', 'Glob', 'Grep', 'Edit', 'Write'],
      timeoutMs: config.taicho.timeoutMs * 0.1,
      skipPermissions: true,
    })
    log.info(`[PM] 統合レビュー完了`)

    return {}
  }

  // --- Prompt Builders ---

  private buildPmoPrompt(ctx: CodingContext): string {
    return `## PMO 指示: Issue の意図を解釈せよ

以下の GitHub Issue を読み、開発チームへの構造化された要件定義を作成してください。

${buildUserPrompt(ctx.issue)}

## 出力する要件定義

以下の項目を明確にしてください:

1. **ゴール**: この Issue が達成しようとしていること（1-2文）
2. **背景**: なぜこの変更が必要なのか
3. **機能要件**: 実装すべき具体的な振る舞い（箇条書き）
4. **非機能要件**: パフォーマンス、セキュリティ等の制約（あれば）
5. **スコープ外**: 明示的にやらないこと
6. **受け入れ基準**: 完了の判定条件

Issue の行間を読み、曖昧な部分は合理的に解釈してください。
コードの変更は行わないでください。`
  }

  private buildArchitectPrompt(ctx: CodingContext, requirements: string): string {
    return `## Architect 指示: 変更設計書を作成せよ

Issue #${ctx.issue.number}: ${ctx.issue.title}

## PMO からの要件定義

${requirements}

## 指示

コードベースを調査し、以下を含む変更設計書を作成してください:

1. **影響範囲**: 変更が必要なファイル一覧と各ファイルの変更概要
2. **アーキテクチャ方針**: 既存パターンとの整合性、採用する設計パターン
3. **インターフェース設計**: 新規・変更する型、関数シグネチャ
4. **依存関係グラフ**: ファイル間の依存関係と変更の波及
5. **リスクと対策**: 破壊的変更のリスクと回避策
6. **テスト方針**: テストすべき項目

コードの変更は行わないでください。設計と分析のみ。`
  }

  private buildPmPlanPrompt(
    ctx: CodingContext,
    requirements: string,
    designDoc: string,
  ): string {
    return `## PM 指示: 実装タスクを分解・スケジュールせよ

Issue #${ctx.issue.number}: ${ctx.issue.title}

## PMO の要件定義

${requirements}

## Architect の設計書

${designDoc}

## 指示

上記を基に、Coder チームへの実装タスクを分解してください。

以下の JSON 形式で出力:

\`\`\`json
{
  "tasks": [
    {
      "id": 1,
      "title": "タスクの簡潔な説明",
      "files": ["対象ファイル"],
      "instructions": "Coder への具体的な実装指示",
      "acceptance_criteria": ["完了条件1", "完了条件2"],
      "depends_on": [],
      "priority": "high|medium|low",
      "estimated_complexity": "small|medium|large"
    }
  ]
}
\`\`\`

## ルール
- 各タスクは1つの論理的な変更に対応させよ
- 型定義・インターフェースの変更は最初のタスクに含めよ
- depends_on には先行タスクの id を指定せよ
- 実行順序通りに並べよ
- テスト・ビルド確認は含めるな（Tester が担当する）
- Coder が迷わない明確な指示を書け`
  }

  private buildCoderPrompt(
    ctx: CodingContext,
    task: EnterpriseTask,
    index: number,
    total: number,
    designDoc: string,
  ): string {
    return `## Coder${index} — 実装指示

Issue #${ctx.issue.number}: ${ctx.issue.title}

**担当タスク [${index}/${total}]**: ${task.title}
**優先度**: ${task.priority}
**対象ファイル**: ${task.files.join(', ') || '未指定'}
**複雑度**: ${task.estimatedComplexity}

## Architect の設計書（参考）

${designDoc}

## 実装指示

${task.instructions}

## 受け入れ基準
${task.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

## ルール
- 割り当てられたタスクのみに集中せよ
- Architect の設計方針に従え
- 既存のコーディング規約に従え
- 変更完了後、git add && git commit せよ
- コミットメッセージ: feat: ${task.title} (#${ctx.issue.number})
- git push は行うな
- .env・認証情報には触れるな`
  }

  private buildTesterPrompt(ctx: CodingContext, requirements: string): string {
    return `## Tester — 品質保証指示

Issue #${ctx.issue.number}: ${ctx.issue.title} の実装が完了しました。
品質保証として以下を実施してください。

## PMO の要件定義（受け入れ基準の参照用）

${requirements}

## チェック項目

### 1. コードレビュー
- 実装が要件定義を満たしているか
- 不要な変更や冗長なコードがないか
- 既存のコーディング規約に沿っているか
- セキュリティ上の問題がないか

### 2. ビルド確認
- ビルドコマンドが存在すれば実行（npm run build 等）

### 3. テスト実行
- テストコマンドが存在すれば実行（npm run test 等）
- テスト結果を確認

### 4. 不備修正
- 問題があれば修正し、git commit せよ
- 修正コミットメッセージ: fix: <問題の概要> (#${ctx.issue.number})

## ルール
- git push は行うな
- 問題がなければ何もせず完了とせよ
- 要件定義のスコープ外の改善は行うな`
  }

  private buildPmReviewPrompt(ctx: CodingContext, requirements: string): string {
    return `## PM 最終統合レビュー

Issue #${ctx.issue.number}: ${ctx.issue.title}

全 Coder の実装と Tester の品質保証が完了しました。
最終統合レビューを実施してください。

## PMO の要件定義

${requirements}

## 確認項目

1. **要件充足**: 要件定義の機能要件がすべて実装されているか
2. **一貫性**: 複数 Coder の実装間で矛盾がないか
3. **受け入れ基準**: PMO が定義した受け入れ基準を満たしているか
4. **最終ビルド・テスト**: エラーがないことを確認

## 判断
- 問題があれば修正し、git commit せよ
- git push は行うな
- 問題がなければ何もせず完了とせよ`
  }

  // --- Plan Parser ---

  private parsePmPlan(content: string): EnterpriseTask[] {
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      const jsonStr = jsonMatch ? jsonMatch[1] : content

      const objectMatch = jsonStr.match(/\{[\s\S]*\}/)
      if (!objectMatch) {
        log.warn('[PM] JSON が見つからない。単一タスクにフォールバック')
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
            acceptanceCriteria: Array.isArray(t.acceptance_criteria)
              ? (t.acceptance_criteria as unknown[]).map(String)
              : [],
            dependsOn: Array.isArray(t.depends_on) ? (t.depends_on as number[]).map(Number) : [],
            priority: this.parsePriority(t),
            estimatedComplexity: this.parseComplexity(t),
          }))
      }
    } catch {
      log.warn('[PM] 計画のパースに失敗。単一タスクにフォールバック')
    }
    return [this.fallbackTask()]
  }

  private parsePriority(t: Record<string, unknown>): 'high' | 'medium' | 'low' {
    const p = String(t.priority ?? 'medium')
    if (p === 'high' || p === 'medium' || p === 'low') return p
    return 'medium'
  }

  private parseComplexity(t: Record<string, unknown>): 'small' | 'medium' | 'large' {
    const c = String(t.estimated_complexity ?? 'medium')
    if (c === 'small' || c === 'medium' || c === 'large') return c
    return 'medium'
  }

  private fallbackTask(): EnterpriseTask {
    return {
      id: 1,
      title: 'Issue 全体を実装',
      files: [],
      instructions: 'Issue の要件をすべて実装してください。',
      acceptanceCriteria: [],
      dependsOn: [],
      priority: 'high',
      estimatedComplexity: 'medium',
    }
  }
}

// --- Types ---

interface EnterpriseTask {
  id: number
  title: string
  files: string[]
  instructions: string
  acceptanceCriteria: string[]
  dependsOn: number[]
  priority: 'high' | 'medium' | 'low'
  estimatedComplexity: 'small' | 'medium' | 'large'
}

// --- System Prompts ---

const PMO_SYSTEM_PROMPT = `あなたは PMO（プロジェクトマネジメントオフィス）です。
ユーザーの Issue を解釈し、開発チームが正確に理解できる構造化された要件定義を作成します。

## 心得
- ユーザーの意図を正確に読み取れ
- 曖昧な表現は合理的に解釈し、明示的な要件に変換せよ
- スコープを明確にし、やらないことも定義せよ
- 受け入れ基準を具体的に記述せよ
- コードには一切触れない。要件定義のみ。`

const ARCHITECT_SYSTEM_PROMPT = `あなたは Architect（設計担当）です。
コードベースを分析し、変更設計書を作成します。

## 心得
- コードベースの既存パターンを正確に把握せよ
- 変更の影響範囲を漏れなく調査せよ
- 既存アーキテクチャとの整合性を重視せよ
- インターフェース設計を明確にせよ
- リスクを特定し、対策を提案せよ
- コードの変更は一切行わない。設計と分析のみ。`

const PM_SYSTEM_PROMPT = `あなたは PM（プロジェクトマネージャー）です。
要件定義と設計書を基に、Coder チームへのタスク分解・分配を管理します。

## 心得
- 自らはコードを書かない。タスクの分解と分配のみ。
- 各タスクは1つの論理的変更に対応させよ
- 依存関係を正確に把握し、実行順序を定めよ
- Coder が迷わない明確な指示を出せ
- 受け入れ基準をタスクごとに設定せよ
- JSON 形式で計画を出力せよ`

const CODER_SYSTEM_PROMPT = `あなたは Coder（実装担当）です。
PM から割り当てられたタスクを、Architect の設計方針に従って実装します。

## 心得
- 割り当てられたタスクのみに集中せよ
- 他のタスクの範囲には手を出すな
- Architect の設計方針に従え
- 既存のコーディング規約に従え
- 受け入れ基準を満たすことを確認せよ
- 変更したら git commit せよ
- git push は行うな
- .env や認証情報には触れるな`

const TESTER_SYSTEM_PROMPT = `あなたは Tester（品質保証担当）です。
Coder チームの実装結果をレビューし、品質を保証します。

## 心得
- コードレビューの視点で実装を確認せよ
- 要件定義との整合性を検証せよ
- ビルドとテストを実行せよ
- 問題があれば修正し、git commit せよ
- git push は行うな
- スコープ外の改善は行うな
- 問題がなければ何もせず完了とせよ`

const PM_REVIEW_SYSTEM_PROMPT = `あなたは PM（プロジェクトマネージャー）です。
全チームの作業が完了した後、最終統合レビューを行います。

## 心得
- 要件が全て満たされているか確認せよ
- 複数 Coder の実装間に矛盾がないか検証せよ
- 受け入れ基準を最終確認せよ
- 問題があれば修正し、git commit せよ
- git push は行うな
- 不要な変更は行うな
- 問題がなければ何もせず完了とせよ`
