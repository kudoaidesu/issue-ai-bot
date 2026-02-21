# アーキテクチャ設計

## 実装フェーズ

| フェーズ | 内容 | 状態 |
|---------|------|------|
| Phase 1 | Issue精緻化 & キューイング | **完了** |
| Phase 2 | AI Coder Agent（コード生成→PR作成） | 未実装 |
| Phase 3 | Reviewer Agent / Webhook連携 | 未実装 |

## 全体像

```
┌─────────────────────────────────────────────────────────────┐
│                    MacBook 2018 サーバー                      │
│                    (Tailscale経由でアクセス)                   │
│                                                             │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────────┐     │
│  │ Discord  │──>│ Issue Refiner│──>│ GitHub Issue      │     │
│  │ Bot      │<──│ Agent        │   │ Manager (Octokit) │     │
│  └──────────┘   └──────────────┘   └────────┬─────────┘     │
│       ↑               ↑                     │              │
│       │          ┌────┴─────┐               │              │
│       │          │ LLM Layer│               │              │
│       │          │ (CLI/SDK)│               │              │
│       │          └──────────┘               │              │
│       │                                      │              │
│       │          ┌──────────────┐             ↓              │
│       └──────────│ Notifier     │   ┌──────────────────┐     │
│                  └──────────────┘   │ Job Queue        │     │
│                         ↑           │ + Cron Scheduler │     │
│                         │           └────────┬─────────┘     │
│                         │                    │              │
│                         │           ┌────────┴─────────┐     │
│                         └───────────│ AI Coder Agent   │     │
│                                     │ (未実装・Phase 2) │     │
│                                     └──────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## コンポーネント詳細

### 1. Discord Bot (`src/bot/`)

Discord.jsで実装するBotサーバー。

**責務:**
- ユーザーからのメッセージ/スラッシュコマンドの受信
- Issue Refinerへの転送
- 処理結果のDiscord通知

**スラッシュコマンド:**
| コマンド | 説明 |
|---------|------|
| `/issue <内容>` | 新しいIssueリクエストを送信 |
| `/status` | キューの状態を確認 |
| `/queue` | 現在のキュー一覧を表示 |
| `/run` | 手動でキュー処理を開始 |
| `/cron` | Cronジョブの状態確認・設定変更 |

**DMモード:**
- DMで直接メッセージを送るだけでIssueリクエストとして処理
- スラッシュコマンド不要の自然な対話
- ユーザーごとのセッション管理による多ターン会話対応

### 2. LLM Layer (`src/llm/`)

Claude Code CLI / Agent SDKの抽象化レイヤー。

**デュアルモード対応:**
| モード | 実装ファイル | 実行方法 |
|--------|------------|---------|
| CLI | `claude-cli.ts` | `claude -p` コマンドを `execFile` で実行 |
| SDK | `claude-sdk.ts` | `@anthropic-ai/claude-code` を動的インポート |

- `LLM_MODE` 環境変数で切り替え（デフォルト: `cli`）
- SDKが未インストールの場合はCLIにフォールバック
- システムプロンプトとユーザープロンプトを受け取り、LLMレスポンスを返す共通インターフェース

### 3. Issue Refiner Agent (`src/agents/issue-refiner/`)

曖昧なユーザー入力を構造化されたGitHub Issueに変換するAIエージェント。

**フロー:**
```
曖昧な入力 → コンテキスト分析 → 不足情報チェック → 逆質問 or Issue生成
```

**精緻化プロセス:**
1. ユーザーの入力をLLM Layerで解析
2. 対象リポジトリのコードベース情報をコンテキストとして付与
3. 情報が不足している場合はDiscord経由で逆質問
4. 十分な情報が揃ったら構造化Issueを生成

**セッション管理:**
- ユーザーごとにマルチターンの会話を追跡
- 構造化JSONレスポンスの検証とフォールバックパース

**生成するIssue構造:**
```markdown
## 概要
[1-2行の要約]

## 背景・目的
[なぜこの変更が必要か]

## 要件
- [ ] 要件1
- [ ] 要件2

## 受け入れ条件
- [ ] 条件1
- [ ] 条件2

## 技術メモ
[関連ファイル、影響範囲など]
```

### 4. GitHub Issue Manager (`src/github/issues.ts`)

Octokit (GitHub REST API) を使ったIssue操作。

**実装済み機能:**
- Issue作成（タイトル、本文、ラベル）
- Issue取得
- Issueステータス更新（open/closed）
- Issueへのコメント追加

**未実装（Phase 2）:**
- PR作成・レビューリクエスト (`pulls.ts`)
- Webhook受信 (`webhooks.ts`)

### 5. Job Queue + Cron Scheduler (`src/queue/`)

IssueをFIFOキューで管理し、Cronで定時処理する。

**キュー管理:**
```typescript
interface QueueItem {
  id: string
  issueNumber: number
  repository: string
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  createdAt: Date
  scheduledAt?: Date
}
```

**Cronスケジュール例:**
| スケジュール | 説明 |
|-------------|------|
| `0 22 * * *` | 毎日22:00にキュー処理開始 |
| `0 2 * * *` | 毎日02:00に処理状況レポート |
| `*/30 * * * *` | 30分ごとに高優先度Issueをチェック |

**永続化:**
- キュー状態はJSONファイル (`data/queue.json`) に保存
- プロセス再起動時に復元可能

### 6. AI Coder Agent (`src/agents/coder/`) — 未実装

> Phase 2 で実装予定。現在はキュー処理時にスタブメッセージを返す。

**計画している実行フロー:**
1. Issueの要件を読み込み
2. 対象リポジトリをクローン/pull
3. Claude Code CLIでコード変更を生成
4. ローカルでビルド・テスト実行
5. ブランチ作成・commit・push
6. PR作成
7. 結果をDiscordに通知

**安全策:**
- 変更はfeatureブランチにのみ push
- mainへの直接pushは禁止
- PR作成後は人間のレビュー・マージを待つ

### 7. Notifier (`src/bot/notifier.ts`)

処理結果をDiscordにリッチEmbed形式で通知する。

**通知タイミング:**
- Issue精緻化完了（Issueリンク付き）
- キュー処理開始・完了
- エラー発生

### 8. CLI Setup Wizard (`src/cli/`)

対話式のセットアップウィザード。

**機能:**
- Claude Code CLIの存在検出
- LLMモード選択（CLI / SDK）
- Discord, GitHub, Cronの設定入力
- `.env` ファイルの自動生成

### 9. Configuration (`src/config.ts`)

環境変数ベースの設定管理。

**主要設定:**
| 変数 | デフォルト | 説明 |
|------|----------|------|
| `LLM_MODE` | `cli` | LLM実行モード（cli/sdk） |
| `LLM_MODEL` | `sonnet` | 使用モデル |
| `CRON_SCHEDULE` | `0 22 * * *` | キュー処理スケジュール |
| `QUEUE_DATA_DIR` | `./data` | キューデータ保存先 |

### 10. Logger (`src/utils/logger.ts`)

構造化ログ出力ユーティリティ。

## データフロー（現在の実装）

```
1. ユーザーがDiscordで「ログイン画面のボタンがずれてる」と送信

2. Discord Bot がメッセージを受信（DM or /issue コマンド）

3. Issue Refiner が LLM Layer 経由で解析
   → 「どのブラウザで発生しますか？」「スクリーンショットはありますか？」と逆質問

4. ユーザーが「Chrome、iPhoneでも。SS無し」と返答

5. Issue Refiner が構造化Issue生成
   → タイトル: "ログイン画面のボタンレイアウト崩れ修正"
   → ラベル: bug, frontend, priority:medium

6. GitHub Issue Manager がIssueを作成
   → Discord に「Issue #42 を作成しました」と通知

7. Cron Scheduler が22:00にキュー処理を開始

8. [Phase 2] AI Coder Agent がIssue #42を処理
   → 現在はスタブ：「AI Coderは未実装です」と通知

9. Notifier がDiscordに結果を通知
```

## 技術選定理由

| 選定 | 理由 |
|------|------|
| **discord.js** | Discord Bot の定番ライブラリ、TypeScript対応、豊富なドキュメント |
| **Octokit** | GitHub公式のREST APIクライアント、TypeScript型定義完備 |
| **Claude Code CLI/SDK** | サブスク枠で動作、API Key不要。CLIとSDKのデュアルモード対応 |
| **node-cron** | 軽量なCronジョブライブラリ、依存なし |
| **Tailscale** | ゼロコンフィグVPN、NAT越え不要 |

## セキュリティ考慮事項

- Discord Bot Token → 環境変数 (`DISCORD_BOT_TOKEN`)
- GitHub Token → 環境変数 (`GITHUB_TOKEN`)
- `.env` ファイルは `.gitignore` に含める
- Tailscaleネットワーク内のみアクセス可能
- LLMはローカル実行（Claude Code CLI）、外部APIキー不要
