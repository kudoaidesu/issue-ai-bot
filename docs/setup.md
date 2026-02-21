# セットアップ手順

## 前提条件

- Node.js 20+
- MacBook 2018 (Intel) に macOS がインストール済み
- Tailscale がインストール・接続済み
- Git がインストール済み

## 1. 外部サービスの準備

### 1.1 Discord Bot の作成

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. 「New Application」→ アプリ名を入力
3. 「Bot」タブ → 「Add Bot」
4. Bot Token をコピー → `.env` に設定
5. 「Privileged Gateway Intents」で以下を有効化:
   - MESSAGE CONTENT INTENT
   - SERVER MEMBERS INTENT
6. 「OAuth2 → URL Generator」で Bot をサーバーに招待:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Read Message History`, `Use Slash Commands`

### 1.2 GitHub Personal Access Token

1. [GitHub Settings → Developer Settings → Personal Access Tokens](https://github.com/settings/tokens)
2. 「Fine-grained tokens」で新規作成
3. 必要な権限:
   - **Issues**: Read and write
   - **Pull requests**: Read and write
   - **Contents**: Read and write
4. トークンをコピー → `.env` に設定

### 1.3 Claude Code CLI

本プロジェクトはClaude Code CLI (`claude -p`) をサブスク枠で使用する（API Key不要）。

1. Claude Code CLIがインストール済みであること
2. `claude` コマンドが実行可能であること
3. 確認: `claude --version`

> **注**: 対話式セットアップウィザード (`npx tsx src/cli/setup.ts`) でも設定可能。

## 2. プロジェクトセットアップ

```bash
# リポジトリをクローン
git clone https://github.com/<your-org>/issue-ai-bot.git
cd issue-ai-bot

# 依存パッケージをインストール
npm install

# 環境変数ファイルを作成
cp .env.example .env
```

## 3. 環境変数の設定

`.env` ファイルを編集:

```env
# Discord
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_discord_server_id
DISCORD_CHANNEL_ID=your_notification_channel_id

# GitHub
GITHUB_TOKEN=your_github_personal_access_token
GITHUB_OWNER=your_github_username
GITHUB_REPO=your_target_repository

# LLM
LLM_MODE=cli                    # cli or sdk
LLM_MODEL=sonnet                # 使用モデル

# Cron
CRON_SCHEDULE=0 22 * * *
CRON_REPORT_SCHEDULE=0 8 * * *

# Queue
QUEUE_DATA_DIR=./data
```

## 4. 開発

```bash
# 開発モードで起動（ホットリロード付き）
npm run dev

# ビルド
npm run build

# テスト
npm run test
```

## 5. サーバー常時起動設定（macOS）

### launchd で自動起動

`~/Library/LaunchAgents/com.issue-ai-bot.plist` を作成:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.issue-ai-bot</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/teruya/workspace/issue-ai-bot/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/teruya/workspace/issue-ai-bot</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/teruya/workspace/issue-ai-bot/logs/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/teruya/workspace/issue-ai-bot/logs/stderr.log</string>
</dict>
</plist>
```

```bash
# サービス登録
launchctl load ~/Library/LaunchAgents/com.issue-ai-bot.plist

# サービス停止
launchctl unload ~/Library/LaunchAgents/com.issue-ai-bot.plist

# ログ確認
tail -f logs/stdout.log
```

## 6. Tailscale 設定

MacBook 2018 サーバーが Tailscale ネットワークに接続済みであれば、
スマホや別PCからDiscord経由で指示を出すだけで利用可能。

```bash
# Tailscale の状態確認
tailscale status

# MacBook の Tailscale IP 確認
tailscale ip
```

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| Discord Bot がオフライン | `launchctl list | grep issue-ai-bot` でサービス確認 |
| GitHub API エラー | トークンの権限とレート制限を確認 |
| Claude CLI エラー | `claude --version` でCLI存在確認、`LLM_MODE` 設定を確認 |
| Cronが動かない | `npm run start` でプロセスが起動しているか確認 |
