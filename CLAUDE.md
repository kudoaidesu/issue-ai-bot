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
- **LLM**: Claude Code CLI / Agent SDK / Codex CLI — 用途ベースで使い分け
- **Cronジョブ**: node-cron
- **サンドボックス**: Docker（AI Coder 実行環境）
- **ネットワーク**: Tailscale（外部アクセス）
- **テスト**: Vitest（ユニット）

## LLM使い分けポリシー

グローバルな `LLM_MODE` 切り替えは廃止。呼び出し元が用途に応じて選択する。

| ファイル | ツール | 用途 |
|---------|-------|------|
| `llm/claude.ts` | Claude CLI (`claude -p`) | 軽量な1ショット処理（Issue精緻化など） |
| `llm/agent.ts` | Agent SDK | 予算制御・進捗通知・セッション管理・危険コマンドブロック（AI Coder） |
| `llm/codex.ts` (将来) | Codex CLI | コードレビュー |

**モデルは呼び出し元が指定する:**
- Issue精緻化 → sonnet
- 計画生成 → opus
- コード生成 → sonnet
- テスト生成 → haiku
- レビュー → codex

## マルチプロジェクト設計

- **プロジェクトごとにDiscordサーバーを分ける**
- **Botは1つ**、複数サーバーに参加
- **guildId でプロジェクトを自動特定**（`projects.json` で登録）
- 各プロジェクトリポジトリの **CLAUDE.md** がAIのコンテキスト管理の中心
- プロジェクト追加 = `projects.json` 追記 + Bot招待 + CLAUDE.md配置（コード変更ゼロ）

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

# 必須: Docker（AI Coder サンドボックス用）
brew install --cask docker

# Discord Bot Tokenは .env に記載
```

## ディレクトリ構造

```
src/
├── agents/            # AIエージェント
│   ├── issue-refiner/ # Issue精緻化AI（実装済み）
│   └── coder/         # AI Coder Agent（Issue→コード→Draft PR）
├── bot/               # Discord Bot
│   ├── commands/      # スラッシュコマンド (issue, status, queue, run, cron)
│   ├── events/        # Discordイベントハンドラ (messageCreate)
│   ├── index.ts       # Bot初期化
│   ├── theme.ts       # カラー・絵文字・Embed生成（共通化）
│   └── notifier.ts    # Discord通知（notify() 1関数）
├── cli/               # CLIツール
│   ├── index.ts       # CLI エントリーポイント
│   └── setup.ts       # 対話式セットアップウィザード
├── github/            # GitHub連携
│   └── issues.ts      # Issue CRUD（gh CLI経由、マルチリポ対応）
├── llm/               # LLMレイヤー（用途ベース使い分け）
│   ├── claude.ts      # Claude CLI — 軽量1ショット
│   └── agent.ts       # Agent SDK — 予算制御・進捗・セッション
├── queue/             # ジョブキュー
│   ├── processor.ts   # キュー管理（JSON永続化、repository必須）
│   └── scheduler.ts   # Cronスケジューラ
├── security/          # セキュリティ
│   ├── hooks.ts       # canUseTool コールバック
│   └── tool-guard.ts  # 危険コマンドブロック
├── utils/             # ユーティリティ
│   ├── logger.ts      # 構造化ログ
│   ├── audit.ts       # 監査ログ（JSONL）
│   ├── sanitize.ts    # 入力サニタイズ
│   └── docker.ts      # Docker サンドボックス
├── config.ts          # 設定管理（Discord Token + 動作設定）
├── projects.json      # プロジェクト登録（guildId, repo, localPath）
└── index.ts           # エントリーポイント

docs/                  # ドキュメント
├── architecture.md    # アーキテクチャ設計（Phase 1-6）
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
                                  guildId → projects.json 逆引き
                                          │
                                  ┌───────┴───────┐
                                  │ Issue Refiner  │ ← 曖昧な指示を精緻化
                                  │ (claude CLI)   │ ← 不足情報は逆質問
                                  └───────┬───────┘
                                          │
                                  ┌───────┴───────┐
                                  │ GitHub Issue   │ ← gh --repo でマルチリポ対応
                                  │ (gh CLI)       │
                                  └───────┬───────┘
                                          │
                                  ┌───────┴───────┐
                                  │ Job Queue      │ ← 共有キュー（全プロジェクト）
                                  │ (node-cron)    │ ← Cronで夜間バッチ処理
                                  └───────┬───────┘
                                          │
                                  ┌───────┴───────┐
                                  │ AI Coder       │ ← Docker サンドボックス内
                                  │ (Agent SDK)    │ ← claude -p --cwd で自動コンテキスト
                                  └───────┬───────┘
                                          │
                                  └── 結果通知 → プロジェクト別 Discord サーバー
```

## LLM利用ポリシー

本プロジェクトは **Claude Code CLI / Agent SDK / Codex CLI** をサブスク枠で使用する。

**OK（サブスク範囲内）:**
- 公式SDK/CLIを使ったローカル・個人用の自動化
- 個人マシン上でのcron実行、Discord連携（自分だけが使う場合）

**NG（ToS違反）:**
- OAuthトークンを抜き出して第三者ツールに渡す
- 他人に配布・公開サービス化する場合はAPIキー（従量課金）に移行が必要

**レート制限の注意:**
- Max枠は5時間ごとにリセットされるセッション上限あり
- Claude Code と Claude 本体の使用量は共通枠
- 夜間バッチはジョブ分散・モデル選択最適化が必要

## 実装フェーズ

| Phase | 内容 | 状態 |
|-------|------|------|
| 1 | Issue精緻化 & キューイング | **完了** |
| 2 | コード簡素化 + マルチプロジェクト基盤 | 未実装 |
| 3 | セキュリティ基盤 + ガードレール | 未実装 |
| 4 | AI Coder Agent（コード生成→PR作成） | 未実装 |
| 5 | Discord UX強化 | 未実装 |
| 6 | 運用強化 | 未実装 |

詳細は `docs/architecture.md` を参照。

## ドキュメント参照

| カテゴリ | パス |
|---------|------|
| アーキテクチャ設計 | `docs/architecture.md` |
| セットアップ手順 | `docs/setup.md` |
