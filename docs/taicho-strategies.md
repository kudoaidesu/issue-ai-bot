# タイチョー Strategy 評価シート

タイチョー（実行隊長）は Strategy パターンで実装を差し替え可能。
各チーム（Strategy）を同じ基準で評価し、Issue の難易度に応じた最適な編成を探る。

## 評価指標

### 定量指標（自動計測可能）

| 指標 | 計測方法 | 単位 |
|------|---------|------|
| **PRマージ率** | マージされた Draft PR / 生成された Draft PR | % |
| **所要時間** | `durationMs` / 1000 | 秒 |
| **リトライ回数** | `retryCount` | 回 |
| **変更行数** | `git diff --stat` 結果 | 行 |
| **ビルド通過率** | CI が通った PR / 全 PR | % |
| **テスト通過率** | テストが通った PR / 全 PR | % |

### 定性指標（人間レビュー）

| 指標 | 評価方法 | スケール |
|------|---------|---------|
| **手直し量** | マージ前に人間が追加したコミット数 | 少ない=良 |
| **レビュー指摘数** | PR レビューのコメント数 | 少ない=良 |
| **要件カバレッジ** | Issue のチェックリスト消化率 | % |
| **デグレ率** | マージ後に発生したバグ / マージ数 | % |
| **コード品質** | 不要な変更、冗長なコードの有無 | 主観 1-5 |

## 難易度分類

| レベル | 説明 | 例 |
|-------|------|-----|
| **S (Simple)** | 1ファイル、数行の変更 | typo修正、設定値変更、文言修正 |
| **M (Medium)** | 2-5ファイル、既存パターンに沿った追加 | 新コマンド追加、既存機能の拡張 |
| **L (Large)** | 5-10ファイル、新パターンの導入 | 新機能追加、リファクタリング |
| **XL (Extra Large)** | 10ファイル以上、アーキテクチャ変更 | 基盤刷新、大規模リファクタ |

## Strategy 一覧

### 1. `claude-cli` (チーム1号)

| 項目 | 内容 |
|------|------|
| **コンセプト** | Claude CLI (`claude -p`) を1ショットで呼び出すシンプル構成 |
| **実装** | `src/agents/taicho/strategies/claude-cli.ts` |
| **LLM** | Claude CLI (sonnet) |
| **ツール** | Bash, Read, Write, Edit, Glob, Grep |
| **実行環境** | ホストマシン直接（プロジェクトの localPath） |
| **タイムアウト** | `config.taicho.timeoutMs` (デフォルト 30分) |
| **想定難易度** | S〜M |

**実装フロー:**
```
Issue → systemPrompt + userPrompt → Claude CLI (1回) → git commit
```

**強み:**
- セットアップ不要、最もシンプル
- Claude CLI の全ツール（Bash, Read, Write, Edit, Glob, Grep）が使える
- 既存パターンに沿った実装が得意
- 実行時間が短い

**弱み:**
- 1ショットなので複雑なタスクで迷走しやすい
- ホスト直接実行のためサンドボックスなし
- 長時間タスク（30分超）でタイムアウト

**推奨用途:**
- `S` レベル Issue（typo修正、設定値変更、1ファイル編集）
- `M` レベルの単純な機能追加（既存パターンに沿ったコマンド追加など）

### 評価ログ

| 日付 | Issue | 難易度 | 結果 | 所要時間 | リトライ | 手直し | メモ |
|------|-------|--------|------|---------|---------|--------|------|
| - | - | - | - | - | - | - | 評価開始前 |

---

### 2. `orchestrator-workers` (チーム2号)

| 項目 | 内容 |
|------|------|
| **コンセプト** | Anthropic「Building effective agents」の Orchestrator-Workers パターン。1つのオーケストレーターが計画、複数のワーカーが実行 |
| **実装** | `src/agents/taicho/strategies/orchestrator-workers.ts` |
| **LLM呼び出し** | 最低3回（計画 → ワーカー×N → 検証） |
| **ツール** | 計画: Read/Glob/Grep のみ、ワーカー: 全ツール、検証: Bash/Read |
| **タイムアウト** | 計画 6分 / ワーカー 9分 / 検証 3分 |
| **想定難易度** | M〜L |

**実装フロー:**
```
Issue
  ↓
[LLM呼び出し1] Orchestrator: タスク分解（読み取り専用）
  ↓ → tasks JSON 出力
[LLM呼び出し2-N] Worker: 各タスク実装（全ツール） × N個
  ↓ → git commit 各タスク毎
[LLM呼び出しN+1] Verifier: ビルド・テスト確認（Bash/Read/Grep）
  ↓
git commit
```

**JSON出力フォーマット（Orchestrator）:**
```json
{
  "tasks": [
    {
      "title": "タスクの簡潔な説明",
      "files": ["対象ファイルパス"],
      "instructions": "具体的な実装指示（Worker へ渡される）"
    }
  ]
}
```

**強み:**
- 計画と実行の分離により、各ワーカーが集中できる
- タスク分解で複雑な Issue も論理的に処理
- Orchestrator が計画段階でコードベースを先に探索するため、的外れな実装が減る
- 複数タスク並行の方がコスト効率的な場合がある

**弱み:**
- LLM呼び出し回数が多いため、実行時間が長い
- Orchestrator の JSON 出力が不正な場合のフォールバックに依存
- Worker 間の連携は暗黙的（前の Worker のコミットを後続が見る）

**推奨用途:**
- `M` レベルの機能追加（複数ファイル、既存パターン）
- `L` レベルの新機能（5-10ファイル、新しい概念）

### 評価ログ

| 日付 | Issue | 難易度 | 結果 | 所要時間 | リトライ | 手直し | メモ |
|------|-------|--------|------|---------|---------|--------|------|
| - | - | - | - | - | - | - | 評価開始前 |

---

### 3. `shogun` (チーム3号)

| 項目 | 内容 |
|------|------|
| **コンセプト** | multi-agent-shogun を参考にした戦国軍制3層構造。軍師（分析）→ 家老（分解）→ 足軽（実行）→ 軍師（検閲） |
| **実装** | `src/agents/taicho/strategies/shogun.ts` |
| **LLM呼び出し** | 最低4回（軍師偵察 → 家老分解 → 足軽×N → 軍師検閲） |
| **ツール** | 軍師: Read/Glob/Grep、家老: Read/Glob/Grep、足軽: 全ツール、軍師検閲: 全ツール |
| **タイムアウト** | 偵察 3分 / 分解 3分 / 足軽 15分×N / 検閲 6分 |
| **想定難易度** | L〜XL |

**4層の役職:**
- **軍師（Gunshi）** - 戦略アドバイザー。最初に偵察、最後に検閲
- **家老（Karo）** - プロジェクト マネージャー。タスク分解と依存関係管理
- **足軽（Ashigaru）** - エンジニア。各タスク実装（複数）
- **軍師（検閲）** - 品質保証と最終確認

**実装フロー:**
```
Issue
  ↓
[LLM呼び出し1] 軍師（偵察）: コードベース分析、戦略レポート生成（読み取り専用）
  ↓
[LLM呼び出し2] 家老: タスク分解、依存関係明示、優先度付け（読み取り専用）
  ↓ → tasks JSON 出力
[LLM呼び出し3-N] 足軽: 各タスク実装（全ツール） × N個、前タスク結果を引き継ぎ
  ↓ → git commit 各タスク毎
[LLM呼び出しN+1] 軍師（検閲）: ビルド・テスト確認、品質保証（全ツール）
  ↓
git commit
```

**JSON出力フォーマット（家老）:**
```json
{
  "tasks": [
    {
      "id": 1,
      "title": "タスクの簡潔な説明",
      "files": ["対象ファイルパス"],
      "instructions": "足軽への具体的な実装指示",
      "depends_on": [],
      "priority": "high|medium|low"
    }
  ]
}
```

**特徴:**
- **依存関係の明示** - `depends_on` で複雑なタスク間依存を表現
- **優先度管理** - 大事なタスクから先に実行
- **二重チェック** - 軍師が偵察と検閲で品質を確保
- **一貫性** - 足軽が前タスク結果を引き継ぐため、統合的な実装

**強み:**
- 分析と計画が分離（軍師 ≠ 家老）でより精密な計画
- 軍師が最初（偵察）と最後（検閲）の2回登場し、品質を二重チェック
- 家老が依存関係を明示的に管理し、足軽の効率を上げる
- 足軽は前のタスク結果を引き継ぐため、一貫性が高い

**弱み:**
- LLM呼び出し回数が多く、実行時間が長い
- 4フェーズのため所要時間がさらに長い
- 各フェーズの出力品質に全体が依存する

**orchestrator-workers との違い:**
- orchestrator-workers: オーケストレーター（計画1回） + ワーカー（実行N回） + 検証（検証1回）
  - **3層**、計画と実行の分離
- shogun: 軍師（偵察1回） + 家老（分解1回） + 足軽（実行N回） + 軍師（検閲1回）
  - **4層**、分析と計画が分離し、品質チェックが2回

**推奨用途:**
- `L` レベルの大型機能（アーキテクチャ変更が必要）
- `XL` レベルの基盤実装（複雑な依存関係、多数のタスク）
- 品質が特に重要な Issue

### 評価ログ

| 日付 | Issue | 難易度 | 結果 | 所要時間 | リトライ | 手直し | メモ |
|------|-------|--------|------|---------|---------|--------|------|
| - | - | - | - | - | - | - | 評価開始前 |

---

### 4. `enterprise` (チーム4号)

| 項目 | 内容 |
|------|------|
| **コンセプト** | 企業組織を模した6層階層構造。PMO（意図解釈）→ Architect（設計）→ PM（計画）→ Coder×N（実装）→ Tester（品質保証）→ PM（統合レビュー） |
| **実装** | `src/agents/taicho/strategies/enterprise.ts` |
| **LLM呼び出し** | 最低6回（PMO → Architect → PM計画 → Coder×N → Tester → PM統合レビュー） |
| **ツール** | PMO: Read/Glob/Grep、Architect: Read/Glob/Grep、PM: Read/Glob/Grep、Coder: 全ツール、Tester: 全ツール、PM統合: 全ツール |
| **タイムアウト** | PMO 1.5分 / Arch 3分 / PM計画 3分 / Coder 12分×N / Tester 6分 / PM統合 3分 |
| **想定難易度** | L〜XL |

**6層の役職:**
- **PMO** - Office of Project Management。Issue の意図を要件定義に翻訳
- **Architect** - 技術設計。コードベース分析、変更設計書作成
- **PM（計画）** - Project Manager。要件 + 設計 から詳細タスク分解
- **Coder** - エンジニア。各タスク実装（複数）
- **Tester** - QA + Code Review。品質保証とテスト実行
- **PM（統合）** - 最終統合レビュー。要件充足確認

**実装フロー:**
```
Issue
  ↓
[LLM呼び出し1] PMO: Issue 意図解釈 → 要件定義（読み取り専用）
  ↓
[LLM呼び出し2] Architect: コード分析 → 設計書（読み取り専用）
  ↓
[LLM呼び出し3] PM（計画）: 要件 + 設計 → タスク分解、優先度・複雑度（読み取り専用）
  ↓ → tasks JSON 出力 (acceptance_criteria 付き)
[LLM呼び出し4-N] Coder: 各タスク実装（全ツール） × N個
  ↓ → git commit 各タスク毎
[LLM呼び出しN+1] Tester: コードレビュー + テスト実行（全ツール）
  ↓
[LLM呼び出しN+2] PM（統合）: 最終統合レビュー（全ツール）
  ↓
git commit
```

**JSON出力フォーマット（PM計画）:**
```json
{
  "tasks": [
    {
      "id": 1,
      "title": "タスクの簡潔な説明",
      "files": ["対象ファイルパス"],
      "instructions": "Coder への具体的な実装指示",
      "acceptance_criteria": ["完了条件1", "完了条件2"],
      "depends_on": [],
      "priority": "high|medium|low",
      "estimated_complexity": "small|medium|large"
    }
  ]
}
```

**特徴:**
- **意図解釈が独立** - PMO が Issue の意図を構造化（他にはない層）
- **本格的な設計フェーズ** - Architect が独立（shogun は軍師で兼任）
- **受け入れ基準が明示** - 各タスクに `acceptance_criteria` を付与
- **品質保証が専門化** - Tester が独立（shogun は軍師が兼任）
- **要件追跡** - PM が計画と統合の2回登場し、要件充足を一貫してチェック
- **複雑度の目安** - `estimated_complexity` で Coder が時間配分を判断

**強み:**
- PMO が Issue の意図を構造化された要件定義に翻訳（唯一の意図解釈層）
- Architect が設計専門（shogun の軍師は偵察寄り、こちらは本格設計）
- Tester が品質保証専門（コードレビュー + テスト実行を分離）
- PM が計画と最終統合の2回登場し、要件充足を一貫してチェック
- Coder に受け入れ基準と設計書が渡されるため、品質基準が明確
- 複雑度の見積もりにより、リソース配分が効率的

**弱み:**
- 6フェーズで LLM 呼び出し回数が最も多い
- フェーズ間の情報伝達にロスが生じる可能性
- PMO の要件解釈が的外れだと後続全体に影響
- 実行時間が最長

**Strategy 比較（6層構造）:**
- orchestrator-workers: オーケストレーター（計画） + ワーカー（実行×N） + 検証（3層、計画 1 回）
- shogun: 軍師（偵察） + 家老（分解） + 足軽（実行×N） + 軍師（検閲）（4層、分析と計画が分離）
- enterprise: PMO + Architect + PM計画 + Coder + Tester + PM統合（6層、意図解釈・設計・テスターが独立、品質が最高）

**推奨用途:**
- `XL` レベルの超大型機能（基盤実装、アーキテクチャ刷新）
- **品質と要件充足が特に重要な Issue**
- 複数チームの協調が必要な場合

### 評価ログ

| 日付 | Issue | 難易度 | 結果 | 所要時間 | リトライ | 手直し | メモ |
|------|-------|--------|------|---------|---------|--------|------|
| - | - | - | - | - | - | - | 評価開始前 |

---

## Strategy 比較表

| 指標 | claude-cli | orchestrator-workers | shogun | enterprise |
|------|-----------|---------------------|--------|-----------|
| **LLM呼び出し回数** | 1 | 3+N | 4+N | 6+N |
| **予想所要時間** | 短（～5分） | 中（～20分） | 長（～30分） | 最長（～40分） |
| **計画の精度** | なし | 中 | 高（偵察+分解が分離） | 最高（PMO+Architect+PM） |
| **品質チェック** | なし | 検証のみ | 偵察+検閲の二重チェック | Tester+PM統合の二重チェック |
| **意図解釈** | なし | なし | なし | ✓ PMO が構造化 |
| **設計フェーズ** | なし | なし | 軽量（偵察） | ✓ 本格設計（Architect） |
| **受け入れ基準** | なし | なし | なし | ✓ 明示（各タスク） |
| **推奨難易度** | **S〜M** | **M〜L** | **L〜XL** | **L〜XL** |
| **推奨シーン** | 軽い修正 | 標準的な機能 | 大型機能・複雑な設計 | 超大型・品質最優先 |

---

## Strategy 自動選択ロジック（実装予定）

Issue の難易度に基づいて、最適な Strategy を自動選択します（Issue #26 Phase 1）。

**判定基準:**

| Issue ラベル | 自動判定（フォールバック） | 推奨 Strategy |
|-------------|------------------------|-------------|
| `difficulty:S` | 行数 < 50 | `claude-cli` |
| `difficulty:M` | 50 ≤ 行数 < 300 | `claude-cli` / `orchestrator-workers` |
| `difficulty:L` | 300 ≤ 行数 < 1000 | `orchestrator-workers` / `shogun` |
| `difficulty:XL` | 行数 ≥ 1000 | `shogun` / `enterprise` |
| （ラベルなし） | Issue タイトル + 説明文を LLM 判定 | `claude-cli`（保守的） |

**選択アルゴリズム（将来実装）:**
```typescript
// src/agents/taicho/strategy-selector.ts (計画中)
async selectStrategy(issue: IssueInfo): Promise<string> {
  // 1. Issue ラベルから難易度抽出
  const difficulty = extractDifficulty(issue.labels) ?? 'M'

  // 2. 難易度 → Strategy 候補
  const candidates = getStrategyCandidates(difficulty)

  // 3. 運用データから最適な Strategy を選択
  //    例: L レベルなら M/L 両方試したが、shogun が成功率 80% なら shogun 選択
  const strategy = selectBestStrategy(candidates)

  return strategy
}
```

---

## PR マージ追跡・評価ログ（実装予定）

Issue #26 Phase 2-3 で以下を実装予定です。

### データ記録の流れ

1. **Strategy 実行前**
   - Issue 難易度を取得
   - Strategy を選択・開始

2. **Strategy 実行中**
   - タスク分解の JSON 出力を検証
   - サブタスク数、LLM 呼び出し回数をカウント

3. **Strategy 実行後**
   - `src/agents/taicho/index.ts` で実行結果を記録
   - `durationMs`, `retryCount`, コミット数、変更行数を集計

4. **PR マージ判定**
   - `/taicho-eval` コマンドで手動評価を記録
   - PR マージ後、変更ファイル数、手直しコミット数を記録

### 記録フィールド（拡張案）

```typescript
interface StrategyEvalRecord {
  timestamp: string
  issueNumber: number
  repository: string

  // 入力
  difficulty: 'S' | 'M' | 'L' | 'XL'
  strategyName: string

  // 実行結果
  success: boolean
  durationMs: number
  retryCount: number

  // コード変更
  commitCount: number
  linesAdded: number
  linesRemoved: number
  filesChanged: number

  // Strategy 詳細
  llmCallCount: number
  llmModels: string[]

  // PR 状態
  prUrl: string
  prMerged: boolean
  prMergedAt?: string

  // 手直し
  fixupCommitCount?: number  // マージ後のリビジョン
  reviewCommentCount?: number  // PR コメント数

  // 品質指標
  buildPassed: boolean
  testsPassed: boolean

  // メモ
  notes?: string
}
```

### 評価ログの自動更新

**実装後、このドキュメントの各 Strategy の「評価ログ」テーブルが以下のようにデータで埋まります：**

**例（claude-cli の場合）:**

| 日付 | Issue | 難易度 | 結果 | 所要時間 | リトライ | 手直し | メモ |
|------|-------|--------|------|---------|---------|--------|------|
| 2026-02-25 | #35 | S | ✓ | 2s | 0 | 0 | typo修正 |
| 2026-02-26 | #36 | M | ✓ | 8s | 0 | 1 | コマンド追加、スペース修正 |
| 2026-02-27 | #37 | M | ✗ | 120s | 2 | 3 | 設定ロジック複雑すぎてリトライ |

---

## 今後の拡張予定

### Phase 1: データ記録基盤（Issue #26）
- [ ] Issue 難易度の自動判定機構
- [ ] Strategy 別の評価データ記録
- [ ] 定量指標の自動計測（所要時間、リトライ数、変更行数）

### Phase 2: Strategy 別レポート（Issue #26）
- [ ] `/strategy-report` コマンド（Strategy 別成功率・平均時間）
- [ ] ダッシュボード拡張（Strategy 別パフォーマンス表示）

### Phase 3: Strategy 自動選択（Issue #26+α）
- [ ] Issue ラベルから難易度自動判定
- [ ] 運用データに基づく Strategy の自動選択
- [ ] A/B テスト機構（「今回は shogun を試す」など）

### Phase 4: PR マージ追跡（Issue #26+α）
- [ ] GitHub Webhook でマージを自動検出
- [ ] 手直しコミット数の集計

---

## メモ

**【重要】このプロジェクトではコスト追跡は実装しません。**
- Claude API コストは LLM 側で管理
- 各 Strategy の「予算配分」（偵察 10% など）は相対的な時間配分の目安のみ
- 実装では所要時間（durationMs）とリトライ数で効率性を評価します

*新しい Strategy を追加したら、このドキュメントにセクションと比較表を更新する。*
