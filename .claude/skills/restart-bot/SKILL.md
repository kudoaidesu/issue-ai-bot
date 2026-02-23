---
name: restart-bot
description: issue-ai-bot の launchd サービスを制御する（再起動・状態確認・ログ確認）。トリガーワード：「再起動」「restart」「ボットを再起動」「サービスを再起動」「bot restart」「起動して」「止めて」「ログ確認」。
---

# issue-ai-bot サービス制御

## サービス情報

| 項目 | 値 |
|------|-----|
| ラベル | `ai.issue-ai-bot` |
| plist | `~/Library/LaunchAgents/ai.issue-ai-bot.plist` |
| 実行ファイル | `dist/index.js`（コンパイル済み） |
| ログ (stdout) | `data/logs/issue-ai-bot.log` |
| ログ (stderr) | `data/logs/issue-ai-bot.err.log` |

## コマンド

### 再起動（ビルドあり）

コードを変更した後は必ずビルドしてから再起動する。

```bash
cd /Users/ai_server/work/issue-ai-bot
npm run build && \
launchctl unload ~/Library/LaunchAgents/ai.issue-ai-bot.plist && \
launchctl load ~/Library/LaunchAgents/ai.issue-ai-bot.plist
```

### 再起動（ビルドなし）

```bash
launchctl unload ~/Library/LaunchAgents/ai.issue-ai-bot.plist && \
launchctl load ~/Library/LaunchAgents/ai.issue-ai-bot.plist
```

### 状態確認

```bash
launchctl list | grep issue-ai-bot
# 出力例: 14432  0  ai.issue-ai-bot
# 列: PID / 終了コード / ラベル
# PID が "-" なら停止中、数値なら起動中
```

### 起動確認（ログ）

```bash
tail -20 /Users/ai_server/work/issue-ai-bot/data/logs/issue-ai-bot.log
```

### エラー確認

```bash
tail -20 /Users/ai_server/work/issue-ai-bot/data/logs/issue-ai-bot.err.log
```

### 停止

```bash
launchctl unload ~/Library/LaunchAgents/ai.issue-ai-bot.plist
```

### 起動

```bash
launchctl load ~/Library/LaunchAgents/ai.issue-ai-bot.plist
```

## 注意事項

- `dist/index.js` を使用するため、**TypeScript ソースを変更した場合は必ず `npm run build` が必要**
- 起動後、ログに `Bot ready: KACHO BOT#3129` が出れば正常
- `KeepAlive: true` のためクラッシュ時は自動再起動される
