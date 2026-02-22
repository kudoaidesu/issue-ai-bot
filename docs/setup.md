# セットアップ手順

## 前提条件

- Node.js 20+
- MacBook 2018 (Intel) に macOS がインストール済み
- Tailscale がインストール・接続済み
- Git がインストール済み

## 1. 外部サービスの準備

### 1.1 Discord Bot の作成

#### Step 1: Application 作成

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. **「New Application」** をクリック → アプリ名を入力 → **「Create」**

#### Step 2: Bot Token 取得

1. 左メニューの **「Bot」** タブを開く
2. **「Reset Token」** をクリックしてトークンを生成
3. トークンをコピーして `.env` の `DISCORD_BOT_TOKEN` に設定

> トークンは一度しか表示されない。紛失したら再度 Reset Token が必要。

#### Step 3: OAuth2 Code Grant を無効化

1. 左メニューの **「OAuth2」** タブを開く
2. **「Require OAuth2 Code Grant」** が **OFF** であることを確認
   - ON だと招待時に「Integration requires code grant」エラーになる

#### Step 4: Privileged Gateway Intents 設定

1. 左メニューの **「Bot」** タブに戻る
2. 下部の **「Privileged Gateway Intents」** セクションで以下を設定:

| Intent | 設定 | 理由 |
|--------|------|------|
| **Message Content Intent** | **ON** | DMメッセージの内容を読むために必須 |
| Server Members Intent | OFF | 未使用 |
| Presence Intent | OFF | 未使用 |

3. **Save Changes**

#### Step 5: Installation 設定（招待URL生成）

1. 左メニューの **「Installation」** タブを開く
2. **「Guild Install」** にチェック
3. **Default Install Settings** の Guild Install で以下を設定:

**Scopes:**
- `bot`
- `applications.commands`

**Permissions（8つ）:**
- View Channels
- Send Messages
- Create Public Threads
- Send Messages in Threads
- Manage Threads
- Embed Links
- Read Message History
- Use Slash Commands

4. **Save Changes**

> **Note:** 旧方式の「OAuth2 > URL Generator」ではなく「Installation」タブを使用する。
> URL Generator は Redirect URI が必要で Bot 招待には不向き。

#### Step 6: サーバーに招待

1. **「Installation」** タブ上部の **Install Link** をコピー
2. ブラウザで開く → **「Add to server」** → 対象サーバーを選択 → **「Authorize」**

または、手動でURLを構築して招待:
```
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands&permissions=326417526784
```
- `YOUR_APP_ID`: General Information ページの Application ID

#### Step 7: Guild ID / Channel ID の取得

1. Discordアプリの **設定 > 詳細設定 > 開発者モード** を **ON**
2. サーバー名を右クリック → **「サーバーIDをコピー」** → `guildId`
3. 通知先チャンネルを右クリック → **「チャンネルIDをコピー」** → `channelId`
4. `projects.json` に記入:

```json
[
  {
    "slug": "your-project",
    "guildId": "コピーしたサーバーID",
    "channelId": "コピーしたチャンネルID",
    "repo": "owner/repo-name",
    "localPath": "/path/to/local/repo"
  }
]
```

### 1.2 GitHub CLI

**GitHub Token は不要。** `gh` CLI の認証セッションを使用する（CLI-First 方針）。

```bash
# GitHub CLI のインストール
brew install gh

# ブラウザ認証でログイン
gh auth login

# 認証確認
gh auth status
```

### 1.3 Claude Code CLI

Claude Code CLI をサブスク枠で使用する（API Key 不要）。

```bash
# インストール
npm install -g @anthropic-ai/claude-code

# 認証セットアップ
claude setup-token

# 確認
claude --version
```

### 1.4 Docker（AI Coder サンドボックス用）

```bash
brew install --cask docker
```

Docker Desktop を起動して、`docker ps` が動作することを確認。

## 2. プロジェクトセットアップ

```bash
# リポジトリをクローン
git clone https://github.com/kudoaidesu/issue-ai-bot.git
cd issue-ai-bot

# 依存パッケージをインストール
npm install

# 環境変数ファイルを作成
cp .env.example .env
```

## 3. 環境変数の設定

`.env` ファイルを編集（**Discord Bot Token のみ**が必須のシークレット）:

```env
# Discord（唯一の必須シークレット）
DISCORD_BOT_TOKEN=your_discord_bot_token

# Claude Code (API Key不要 — claude CLIのサブスク枠を使用)
LLM_MODEL=sonnet

# Cron (cron expression, Asia/Tokyo)
CRON_SCHEDULE=0 1 * * *
CRON_REPORT_SCHEDULE=0 9 * * *

# Queue
QUEUE_DATA_DIR=./data
QUEUE_MAX_BATCH_SIZE=5
QUEUE_COOLDOWN_MS=60000
QUEUE_DAILY_BUDGET_USD=20
QUEUE_MAX_RETRIES=2
QUEUE_RETRY_BASE_MS=300000

# AI Coder Agent
CODER_MAX_BUDGET_USD=5
CODER_MAX_RETRIES=3
CODER_TIMEOUT_MS=1800000
```

> **GitHub Token / API Key は `.env` に書かない。** CLI-First 方針を参照。

## 4. 開発

```bash
# 開発モードで起動（ホットリロード付き）
npm run dev

# ビルド
npm run build

# テスト
npm run test

# 対話式セットアップ
npm run setup
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
| 「Integration requires code grant」エラー | Developer Portal > OAuth2 > 「Require OAuth2 Code Grant」を OFF にする |
| Bot がサーバーに表示されない | コード（`npm run dev`）が起動しているか確認。Bot は起動していないとオフライン |
| スラッシュコマンドが出ない | `projects.json` の `guildId` が正しいか確認 |
| Discord Bot がオフライン | `launchctl list \| grep issue-ai-bot` でサービス確認 |
| GitHub API エラー | `gh auth status` で認証状態を確認 |
| Claude CLI エラー | `claude --version` でCLI存在確認 |
| Cron が動かない | `npm run start` でプロセスが起動しているか確認 |
