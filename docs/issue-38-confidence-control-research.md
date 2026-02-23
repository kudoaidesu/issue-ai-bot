# Issue #38: 回答確度段階制御モデル — トレンド調査報告書

## エグゼクティブサマリー

本報告書は、GitHub Issue #38「回答確度段階制御モデル — トレンド調査 × UX改善」に基づき、AI応答における確信度表示・段階的回答フローのアカデミック・技術トレンドを調査した結果をまとめたものである。

**主要な発見:**
1. **不確実性定量化(UQ)** は2025年LLM研究の最重要テーマの一つ
2. **確信度スコア表示** は視覚的UI（0-100%、Low/Med/High、色分け）で実装されている
3. **段階的情報開示(Progressive Disclosure)** がAI UXのベストプラクティス
4. **中程度の不確実性表現** が最もユーザー信頼度・満足度・パフォーマンスが高い

---

## 1. アカデミックトレンド調査

### 1.1 不確実性定量化(Uncertainty Quantification)の最新研究

#### 主要論文

| タイトル | 著者/組織 | 年 | 関連度 |
|---------|----------|---|--------|
| [Uncertainty Quantification and Confidence Calibration in Large Language Models: A Survey](https://arxiv.org/abs/2503.15850) | arXiv | 2025 | ★★★ |
| [Do LLMs Estimate Uncertainty Well](https://proceedings.iclr.cc/paper_files/paper/2025/file/ef472869c217bf693f2d9bbde66a6b07-Paper-Conference.pdf) | ICLR 2025 | 2025 | ★★★ |
| [A Survey on Uncertainty Quantification of Large Language Models](https://arxiv.org/abs/2412.05563) | arXiv | 2024 | ★★★ |
| [Understanding the Effects of Miscalibrated AI Confidence on User Trust](https://arxiv.org/html/2402.07632v4) | arXiv | 2024 | ★★☆ |

#### 主要な発見

**1. 不確実性の4次元分類 (Taxonomy)**

[arXiv:2503.15850](https://arxiv.org/abs/2503.15850) では、LLMの不確実性を以下の4次元で分類している:

- **Input Uncertainty**: 入力の曖昧性（ユーザーの質問が不明確）
- **Reasoning Uncertainty**: 推論経路の分岐（複数の解釈が可能）
- **Parameter Uncertainty**: モデルパラメータの不確実性
- **Prediction Uncertainty**: 出力の確信度

**2. キャリブレーションの課題**

[ICLR 2025論文](https://proceedings.iclr.cc/paper_files/paper/2025/file/ef472869c217bf693f2d9bbde66a6b07-Paper-Conference.pdf)によると:

> "Better-performing LLMs show more aligned overall confidence levels, however, **even the most accurate models still show minimal variation in confidence between right and wrong answers**."

つまり、**高性能なLLMでも、正解・不正解の確信度の差が小さい**という課題がある。

**3. Thermometer手法 (MIT発)**

[MIT News](https://news.mit.edu/2024/thermometer-prevents-ai-model-overconfidence-about-wrong-answers-0731)で紹介された「Thermometer」手法:

- 補助的な小型モデルを使ってメインLLMをキャリブレーション
- 未知のタスクでもより正確な確信度を提供
- 計算効率が高い

---

### 1.2 確信度表示のUXトレンド

#### UI/UXパターン研究

| 資料 | 組織 | 関連度 |
|------|------|--------|
| [Confidence Score - AI Interface Design Patterns](https://www.aiuxplayground.com/pattern/confidence-score) | AI UX Playground | ★★★ |
| [Confidence Visualization UI Patterns](https://agentic-design.ai/patterns/ui-ux-patterns/confidence-visualization-patterns) | Agentic Design | ★★★ |
| [Designing a Confidence-Based Feedback UI](https://medium.com/design-bootcamp/designing-a-confidence-based-feedback-ui-f5eba0420c8c) | Medium | ★★☆ |
| [The Impact of Confidence Ratings on User Trust in LLMs](https://dl.acm.org/doi/10.1145/3708319.3734178) | ACM 2025 | ★★★ |

#### 主要な発見

**1. 視覚的デザインアプローチ**

[Confidence Visualization Patterns](https://agentic-design.ai/patterns/ui-ux-patterns/confidence-visualization-patterns)で推奨されるパターン:

```
High (95%+):  ✅ Green check
Medium (70%): ⚠️  Orange caution
Low (30%):    ❌ Red warning
```

**2. UIデザインの3原則**

[AI Interface Design Patterns](https://www.aiuxplayground.com/pattern/confidence-score)より:

1. **Transparent**: 確信度を明示する
2. **Actionable**: ユーザーが対処できる形で提示
3. **Easy to ignore**: 正常時は目立たない

**3. 段階的情報開示(Progressive Disclosure)**

[Progressive Disclosure in AI-Powered Product Design](https://uxplanet.org/progressive-disclosure-in-ai-powered-product-design-978da0aaeb08) (2026年1月):

> "Progressive disclosure ensures that the initial experience is clean and focused on immediate success, with **clear pathways to deeper information as the user's skills and needs evolve**."

AI Chatbotでの適用例:
- **初期表示**: 簡潔な回答 + 確信度インジケーター
- **詳細表示**: 展開可能な根拠・代替候補・参考情報

---

### 1.3 不確実性コミュニケーションの人間科学

#### 重要研究

| タイトル | 組織 | 年 | 関連度 |
|---------|------|---|--------|
| [Confronting verbalized uncertainty in LLMs](https://www.sciencedirect.com/science/article/pii/S1071581925000126) | ScienceDirect | 2025 | ★★★ |
| [Metacognition and Uncertainty Communication](https://journals.sagepub.com/doi/10.1177/09637214251391158) | SAGE Journals | 2025 | ★★☆ |

#### 主要な発見

**1. 中程度の不確実性表現が最適**

[ScienceDirect研究](https://www.sciencedirect.com/science/article/pii/S1071581925000126):

> "**Medium verbalized uncertainty** in LLM expressions consistently leads to **higher user trust, satisfaction, and task performance** compared to high and low verbalized uncertainty."

つまり:
- ❌ 低い不確実性表現: 「これは〇〇です」→ 後で修正すると信頼を失う
- ✅ 中程度の不確実性表現: 「〇〇の可能性が高いです(67% confident)」→ 最も信頼される
- ❌ 高い不確実性表現: 「わかりません」→ ユーザーが困惑

**2. マルチエージェントAIの透明性**

[World Economic Forum](https://www.weforum.org/stories/2025/08/rethinking-the-user-experience-in-the-age-of-multi-agent-ai/):

複雑性が裏側で進行すると、ユーザーに不透明感・不確実性を与える。推奨される対策:
- 作業の可視化(Making work visible)
- エージェントの進捗を表示
- 待機理由の説明

---

## 2. OSSコード調査

### 2.1 調査対象リポジトリ

| リポジトリ | Stars | 技術スタック | 特徴 |
|-----------|-------|-------------|------|
| [watson-developer-cloud/node-sdk](https://github.com/watson-developer-cloud/node-sdk) | N/A | TypeScript | IBM Watson Assistant — 確信度スコア実装の先行例 |
| [sear-chat/SearChat](https://github.com/sear-chat/SearChat) | N/A | TypeScript | 検索結果の確信度スコア |
| [zaidmukaddam/scira](https://github.com/zaidmukaddam/scira) | 11,462 | Next.js + Vercel AI SDK | AI検索エンジン、エラー処理のベストプラクティス |

### 2.2 発見したパターン

#### パターン1: 確信度スコアの型定義

**リポジトリ**: watson-developer-cloud/node-sdk
**ファイル**: `assistant/v2.ts`

```typescript
/**
 * The confidence scores for determining whether to show the generated response
 * or an "I don't know" response.
 */
interface ConfidenceScores {
  /** The confidence score based on user query and search results (pre-generation). */
  pre_gen?: number;
  /** The pre_gen confidence score threshold. If the pre_gen score is below this threshold,
   *  it shows an "I don't know" response instead of generating. */
  pre_gen_threshold?: number;

  /** The confidence score based on user query, search results, and the generated response. */
  post_gen?: number;
  /** The post_gen confidence score threshold. If the post_gen score is below this threshold,
   *  it shows an "I don't know" response instead of the generated answer. */
  post_gen_threshold?: number;
}

/**
 * An array of intents recognized in the user input,
 * sorted in descending order of confidence.
 */
interface RuntimeIntent {
  /** A decimal percentage that represents confidence in the intent. */
  confidence?: number;
}
```

**当プロジェクトへの適用:**
- ✅ 生成前(pre-gen)・生成後(post-gen)の2段階確信度チェック
- ✅ 閾値以下の場合は「わからない」を返す設計

#### パターン2: 検索結果のスコアリング

**リポジトリ**: sear-chat/SearChat
**ファイル**: `packages/deepresearch/src/types.ts`

```typescript
/**
 * Search result item definition
 */
export interface SearchResultItem {
  id: string | number;
  title: string;
  content: string;
  source?: string;
  url?: string;
  date?: string;
  // confidence score
  score?: number;
}
```

**当プロジェクトへの適用:**
- ✅ 検索・参照元ごとにスコアを保持
- ✅ 回答の根拠となる情報の信頼度を明示

#### パターン3: エラーハンドリングと段階的表示

**リポジトリ**: zaidmukaddam/scira
**ファイル**: `components/message.tsx`

Sciraでは、エラー時に以下の段階的情報を表示:
1. エラータイプ（アイコン）
2. エラーメッセージ（簡潔）
3. エラー原因（詳細、オプショナル）
4. アクション（Retry, Sign In等）

**当プロジェクトへの適用:**
- ✅ Discord Embed の階層構造で段階的情報開示が可能
- ✅ ボタンによるアクション誘導

---

## 3. 業界事例

### 3.1 Anthropic の実装

[Anthropic Research: Measuring AI agent autonomy](https://www.anthropic.com/research/measuring-agent-autonomy):

> "Claude limits its own independence by **pausing to ask questions when it's uncertain**."

これは本プロジェクトの**トリさん（逆質問AI）** と同様のアプローチである。

### 3.2 Vercel の段階的導入

[Vercel Blog: Transforming customer support with AI](https://vercel.com/blog/transforming-customer-support-with-ai-how-vercel-decreased-tickets):

> "After seeing positive validation with a 16% reduction in support tickets, Vercel gained the **confidence to ramp up to a 100% rollout**."

段階的な検証→ロールアウトで信頼を構築。

---

## 4. 改善設計書

### 4.1 現状の課題

本プロジェクト(`issue-ai-bot`)における確度段階制御の課題:

| 箇所 | 現状の問題 | 影響 |
|------|-----------|------|
| **トリさん**(Issue精緻化) | 断定的な要約後に修正することがある | ユーザー混乱 |
| **Discord通知** | 進捗状況の確信度が不明 | 「信じていいのか？」という不安 |
| **タイチョー実行結果** | 成功・失敗の2値のみ（部分成功の表現がない） | 中間状態を評価できない |

### 4.2 提案する改善方式

#### 4.2.1 確信度3段階制御

| レベル | 確信度 | 表現 | UI表示 |
|--------|-------|------|--------|
| **High** | 90%+ | 「〇〇です」 | 🟢 緑チェック |
| **Medium** | 50-89% | 「〇〇の可能性が高いです」 | 🟡 黄色注意 |
| **Low** | <50% | 「不確実です。〇〇または△△の可能性があります」 | 🔴 赤警告 + 逆質問 |

#### 4.2.2 段階的情報開示フロー

```
[初期表示] 簡潔な回答 + 確信度インジケーター
    ↓
[ユーザーが詳細ボタンをクリック]
    ↓
[詳細表示] 根拠・参考情報・代替候補
```

Discord実装例:

```typescript
// 初期Embed
{
  title: "✅ Issue精緻化完了（確信度: 85%）",
  description: "認証フロー改善の実装Issue",
  footer: "詳細を見る → リアクション 👁️"
}

// 詳細Embed（リアクション後に表示）
{
  fields: [
    { name: "根拠", value: "CLAUDE.md の認証ポリシーに基づく" },
    { name: "不確実な点", value: "OAuth vs JWT の選択は未確定" },
    { name: "代替案", value: "Session-based 認証も検討可" }
  ]
}
```

#### 4.2.3 確信度スコアの型定義

```typescript
// src/types/confidence.ts

/**
 * 確信度レベル
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * 確信度情報
 */
export interface ConfidenceInfo {
  /** 確信度レベル */
  level: ConfidenceLevel;
  /** スコア (0-100) */
  score: number;
  /** 根拠 */
  rationale?: string;
  /** 不確実な点 */
  uncertainties?: string[];
  /** 代替候補 */
  alternatives?: string[];
}

/**
 * 確信度付きレスポンス
 */
export interface ConfidenceAwareResponse<T> {
  /** レスポンス本体 */
  data: T;
  /** 確信度情報 */
  confidence: ConfidenceInfo;
}
```

#### 4.2.4 実装箇所

| 箇所 | 修正内容 | 優先度 |
|------|---------|--------|
| `src/agents/torisan/index.ts` | LLMレスポンスから確信度を推定 | 高 |
| `src/bot/theme.ts` | 確信度別のEmbed生成関数を追加 | 高 |
| `src/bot/notifier.ts` | 段階的情報開示ロジック（リアクション対応） | 中 |
| `src/agents/taicho/index.ts` | 実行結果の確信度（成功・部分成功・失敗）を追加 | 中 |

---

## 5. 実装優先度の提案

### Phase 7-1: 確信度表示基盤（優先度: 高）

**目標**: 確信度を視覚化する基盤を構築

**タスク**:
1. `src/types/confidence.ts` の追加
2. `src/bot/theme.ts` に確信度別Embed生成関数を追加
   - `createConfidenceEmbed(level, title, description, details?)`
3. トリさんのレスポンスに確信度を含める

**期待効果**:
- ユーザーが「信じていいのか」を判断できる
- 不確実な回答に対する期待値調整

**工数見積**: 1-2日

---

### Phase 7-2: 段階的情報開示（優先度: 中）

**目標**: 詳細情報をオンデマンドで表示

**タスク**:
1. Discord リアクション対応を追加（👁️ で詳細表示）
2. `src/bot/notifier.ts` に詳細Embed生成ロジックを追加
3. 確信度が Medium/Low のときは自動的に詳細を展開

**期待効果**:
- 初期表示がシンプル
- 必要な人だけが詳細を見る（Progressive Disclosure）

**工数見積**: 2-3日

---

### Phase 7-3: タイチョー結果の確信度（優先度: 中）

**目標**: コード生成結果の信頼度を明示

**タスク**:
1. タイチョーの実行結果に確信度を追加
   - ビルド成功 + テスト成功 → High
   - ビルド成功 + テスト失敗 → Medium
   - ビルド失敗 → Low
2. PR作成時の説明文に確信度を記載

**期待効果**:
- レビュアーが優先度を判断しやすい
- 部分成功を適切に評価

**工数見積**: 1-2日

---

### Phase 7-4: 確信度ベースの自動判断（優先度: 低）

**目標**: 確信度が低い場合は自動的に逆質問する

**タスク**:
1. トリさんが確信度 Low の場合、自動的にユーザーに質問を返す
2. タイチョーが確信度 Low の場合、実行を一時停止してユーザー確認を求める

**期待効果**:
- ユーザーの手戻りを防ぐ
- 無駄な処理を回避

**工数見積**: 2-3日

---

## 6. 推奨アクション

### 短期（今すぐ適用可能）

1. **Phase 7-1を即座に実装**
   確信度型定義 + Embed生成関数は2-3時間で実装可能。

2. **トリさんのプロンプトに確信度出力を追加**
   ```
   あなたの回答の確信度を以下の形式で出力してください:
   - High (90%+): 確実に正しいと判断できる
   - Medium (50-89%): おそらく正しいが、不確実な要素がある
   - Low (<50%): 複数の解釈が可能で、確信できない
   ```

### 中期（次のフェーズで検討）

1. **Phase 7-2, 7-3を実装**
   段階的情報開示とタイチョー結果の確信度。

2. **確信度ログの記録**
   `src/utils/audit.ts` に確信度を記録し、精度向上のフィードバックループを構築。

### 長期（ウォッチ継続）

1. **MIT Thermometer手法の導入検討**
   補助モデルで確信度をキャリブレーションする手法。

2. **マルチエージェント透明性の強化**
   タイチョー実行中の進捗を細かく通知（World Economic Forum推奨）。

---

## 7. 参考文献

### 学術論文

- [Uncertainty Quantification and Confidence Calibration in Large Language Models: A Survey](https://arxiv.org/abs/2503.15850)
- [Do LLMs Estimate Uncertainty Well (ICLR 2025)](https://proceedings.iclr.cc/paper_files/paper/2025/file/ef472869c217bf693f2d9bbde66a6b07-Paper-Conference.pdf)
- [A Survey on Uncertainty Quantification of Large Language Models](https://arxiv.org/abs/2412.05563)
- [Understanding the Effects of Miscalibrated AI Confidence on User Trust](https://arxiv.org/html/2402.07632v4)
- [Confronting verbalized uncertainty in LLMs](https://www.sciencedirect.com/science/article/pii/S1071581925000126)
- [Metacognition and Uncertainty Communication](https://journals.sagepub.com/doi/10.1177/09637214251391158)

### UI/UXパターン

- [Confidence Score - AI Interface Design Patterns](https://www.aiuxplaybook.com/pattern/confidence-score)
- [Confidence Visualization UI Patterns](https://agentic-design.ai/patterns/ui-ux-patterns/confidence-visualization-patterns)
- [Designing a Confidence-Based Feedback UI](https://medium.com/design-bootcamp/designing-a-confidence-based-feedback-ui-f5eba0420c8c)
- [The Impact of Confidence Ratings on User Trust in LLMs](https://dl.acm.org/doi/10.1145/3708319.3734178)
- [Progressive Disclosure in AI-Powered Product Design](https://uxplanet.org/progressive-disclosure-in-ai-powered-product-design-978da0aaeb08)

### 業界事例

- [Anthropic: Measuring AI agent autonomy](https://www.anthropic.com/research/measuring-agent-autonomy)
- [Vercel: Transforming customer support with AI](https://vercel.com/blog/transforming-customer-support-with-ai-how-vercel-decreased-tickets)
- [MIT News: Method prevents an AI model from being overconfident](https://news.mit.edu/2024/thermometer-prevents-ai-model-overconfidence-about-wrong-answers-0731)
- [World Economic Forum: Rethinking UX in multi-agent AI](https://www.weforum.org/stories/2025/08/rethinking-the-user-experience-in-the-age-of-multi-agent-ai/)

### OSS

- [watson-developer-cloud/node-sdk](https://github.com/watson-developer-cloud/node-sdk)
- [sear-chat/SearChat](https://github.com/sear-chat/SearChat)
- [zaidmukaddam/scira](https://github.com/zaidmukaddam/scira)

---

## 8. 結論

本調査により、以下が明らかになった:

1. **確信度表示は2025年のLLM UXのベストプラクティス**である
2. **中程度の不確実性表現**がユーザー信頼度を最大化する
3. **段階的情報開示(Progressive Disclosure)** がAI Chatbotの標準パターン
4. **2段階確信度チェック(pre-gen/post-gen)** がIBM Watsonで実装済み

本プロジェクトでは、**Phase 7-1（確信度表示基盤）を最優先**で実装し、段階的にUXを改善することを推奨する。

---

**作成日**: 2026-02-24
**調査担当**: タイチョー（実行隊長）AI
**Issue番号**: #38
