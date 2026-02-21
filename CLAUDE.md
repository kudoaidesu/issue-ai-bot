# プロジェクトルール

## 設計思想: CLI-First

本プロジェクトは **外部サービスのトークンを環境変数で管理しない** 方針をとる。
各ツールのCLIが持つ認証セッションをそのまま利用し、Node.jsプロセスにシークレットを渡さない。

| サービス | アクセス手段 | 認証方法 |
|---------|-------------|---------|
| GitHub | `gh` CLI | `gh auth login`（OAuth/ブラウザ認証） |
| Claude | `claude` CLI / Agent SDK | `claude setup-token`（サブスク認証） |
| Discord | discord.js SDK | Bot Token（.envで管理 — SDK要件により必須） |

**Discord Bot Token のみ `.env` で管理する。** これは discord.js が起動時にトークンを引数として受け取る仕様のため。
それ以外のトークン（GitHub Token, API Key等）は `.env` に書かない。

## 絶対厳守ルール

### データベース操作
- **禁止**: `db reset`、`DELETE FROM`、`TRUNCATE` をユーザー許可なく実行
- **必須**: 破壊的操作は必ずユーザーに確認してから実行

### 言語制限
- **禁止**: Pythonスクリプトの実行（スキル内のPythonも含む）
- **必須**: スクリプトはすべてTypeScript（tsx）またはNode.jsで作成
- **必須**: `npx tsx` でTypeScriptスクリプトを実行

## 技術スタック

- **ランタイム**: Node.js + TypeScript
- **Discord Bot**: discord.js
- **GitHub連携**: `gh` CLI（トークン不要、`gh auth login` の認証セッションを使用）
- **LLM**: Claude Code CLI (`claude -p`) / Agent SDK — サブスク枠で動作、API Key不要
- **Cronジョブ**: node-cron
- **ネットワーク**: Tailscale（外部アクセス）
- **テスト**: Vitest（ユニット）

## ブランチ戦略

```
feature/* or fix/* → develop → main（PR経由）
```

- 1ブランチ1機能、ビルド確認必須
- mainへの直接マージ禁止

## コーディング規約

- 命名: camelCase（変数・関数）/ PascalCase（型・コンポーネント）
- `any`型禁止
- ESM (import/export) を使用

## 実行コマンド

```bash
npm run setup            # 対話式セットアップ
npm run dev              # 開発サーバー（Bot起動）
npm run build            # ビルド
npm run test             # テスト
npm run start            # 本番起動
```

## 前提ツール

```bash
# 必須: Claude Code CLI
npm install -g @anthropic-ai/claude-code
claude setup-token

# 必須: GitHub CLI
brew install gh
gh auth login

# Discord Bot Tokenは .env に記載
```

## ディレクトリ構造

```
src/
├── agents/            # AIエージェント
│   └── issue-refiner/ # Issue精緻化AI（実装済み）
├── bot/               # Discord Bot
│   ├── commands/      # スラッシュコマンド (issue, status, queue, run, cron)
│   ├── events/        # Discordイベントハンドラ (messageCreate)
│   ├── index.ts       # Bot初期化
│   └── notifier.ts    # Discord通知（リッチEmbed）
├── cli/               # CLIツール
│   ├── index.ts       # CLI エントリーポイント
│   └── setup.ts       # 対話式セットアップウィザード
├── github/            # GitHub連携
│   └── issues.ts      # Issue CRUD（gh CLI経由）
├── llm/               # LLM抽象化レイヤー
│   ├── index.ts       # 共通インターフェース
│   ├── claude-cli.ts  # Claude Code CLI モード
│   └── claude-sdk.ts  # Agent SDK モード
├── queue/             # ジョブキュー
│   ├── processor.ts   # キュー処理（JSON永続化）
│   └── scheduler.ts   # Cronスケジューラ
├── utils/             # ユーティリティ
│   └── logger.ts      # 構造化ログ
├── config.ts          # 設定管理（Discord Token + 動作設定のみ）
└── index.ts           # エントリーポイント

docs/                  # ドキュメント
├── architecture.md    # アーキテクチャ設計
└── setup.md           # セットアップ手順
```

## プロジェクト概要

- **ビジョン**: Issue駆動 × AI駆動の自律型開発ワークフローを構築する
- **ターゲット**: 個人開発者（自分自身）がスマホや別PCから指示を出し、AIが夜間にIssueを処理する
- **制約**:
  - サーバー: MacBook 2018 (Intel CPU) 常時稼働
  - ネットワーク: Tailscale経由のリモートアクセス
  - LLM: Claude Code CLI/Agent SDK（Maxサブスク枠、ローカル実行）

## アーキテクチャ概要

```
[スマホ/別PC]                     [MacBook 2018 サーバー]
    │                                     │
    └── Discord ── Tailscale ──── Discord Bot (discord.js)
                                          │
                                  ┌───────┴───────┐
                                  │ Issue Refiner  │ ← 曖昧な指示を精緻化
                                  │ (claude -p)    │ ← 不足情報は逆質問
                                  └───────┬───────┘
                                          │
                                  ┌───────┴───────┐
                                  │ GitHub Issue   │ ← 構造化されたIssue作成
                                  │ (gh CLI)       │ ← トークン不要
                                  └───────┬───────┘
                                          │
                                  ┌───────┴───────┐
                                  │ Job Queue      │ ← Cronで夜間バッチ処理
                                  │ (node-cron)    │
                                  └───────┬───────┘
                                          │
                                  ┌───────┴───────┐
                                  │ AI Coder       │ ← Issue→コード→PR
                                  │ (claude -p)    │
                                  └───────┬───────┘
                                          │
                                  └── 結果通知 → Discord
```

## LLM利用ポリシー

本プロジェクトは **Claude Code CLI (`claude -p`) / Agent SDK** をサブスク枠で使用する。

**OK（サブスク範囲内）:**
- 公式SDK/CLIを使ったローカル・個人用の自動化
- 個人マシン上でのcron実行、Discord/Slack連携（自分だけが使う場合）

**NG（ToS違反）:**
- OAuthトークンを抜き出して第三者ツールに渡す（OpenClaw方式）
- 他人に配布・公開サービス化する場合はAPIキー（従量課金）に移行が必要

**スケール時の注意:**
- ビジネス化・公開時 → Claude Console APIキーに切り替え
- 24/7大量トークン消費 → 共有リミットに注意

## ドキュメント参照

| カテゴリ | パス |
|---------|------|
| アーキテクチャ設計 | `docs/architecture.md` |
| セットアップ手順 | `docs/setup.md` |
