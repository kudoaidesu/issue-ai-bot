# Issue AI Bot

Issue駆動 × AI駆動の自律型開発ワークフロー。Discordから指示を出すと、AIがIssueを精緻化し、夜間にキュー処理してPRを自動生成する。

## コンセプト

```
人間（Discord）→ Issue Refiner AI → GitHub Issue → Cron Queue → AI Coder → PR作成
```

1. **Discord経由で指示**: スマホや別PCからメモ・修正依頼を送信
2. **Issue精緻化**: AIが曖昧な指示を構造化し、不足情報は逆質問
3. **キュー管理**: 整備されたIssueをキューに登録
4. **夜間バッチ処理**: Cronで夜間にAIがIssueを順次処理
5. **結果通知**: PR作成後にDiscordで通知

## 設計思想: CLI-First

外部サービスのトークンを環境変数で管理しない。各CLIの認証セッションをそのまま利用する。

| サービス | アクセス手段 | 認証 |
|---------|-------------|------|
| GitHub | `gh` CLI | `gh auth login` |
| Claude | `claude` CLI / Agent SDK | `claude setup-token` |
| Discord | discord.js SDK | Bot Token（.env — SDK要件により必須） |

## アーキテクチャ

```
[スマホ/別PC]                     [MacBook 2018 サーバー]
    │                                     │
    └── Discord ── Tailscale ──── Discord Bot (discord.js)
                                          │
                                  ┌───────┴───────┐
                                  │ Issue Refiner  │
                                  │ (claude -p)    │
                                  └───────┬───────┘
                                          │
                                  ┌───────┴───────┐
                                  │ GitHub Issue   │
                                  │ (gh CLI)       │
                                  └───────┬───────┘
                                          │
                                  ┌───────┴───────┐
                                  │ Cron Queue     │
                                  │ (node-cron)    │
                                  └───────┬───────┘
                                          │
                                  ┌───────┴───────┐
                                  │ AI Coder       │
                                  │ (claude -p)    │
                                  └───────┴───────┘
                                          │
                                  └── Discord 通知
```

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| ランタイム | Node.js + TypeScript |
| Discord Bot | discord.js |
| GitHub連携 | `gh` CLI（トークン不要） |
| LLM | Claude Code CLI / Agent SDK（サブスク枠） |
| Cronジョブ | node-cron |
| ネットワーク | Tailscale |
| テスト | Vitest |

## 前提ツール

```bash
# Claude Code CLI
npm install -g @anthropic-ai/claude-code
claude setup-token

# GitHub CLI
brew install gh
gh auth login

# Node.js >= 20
```

## セットアップ

```bash
npm install
npm run setup   # 対話式セットアップ（.env作成）
npm run dev     # 開発モードで起動
```

詳細は [docs/setup.md](docs/setup.md) を参照。

## ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [docs/architecture.md](docs/architecture.md) | アーキテクチャ設計詳細 |
| [docs/setup.md](docs/setup.md) | セットアップ手順 |
