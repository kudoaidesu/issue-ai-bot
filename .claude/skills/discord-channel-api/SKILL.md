---
name: discord-channel-api
description: Discord REST APIを使ったチャンネル操作（作成・編集・削除・メッセージ送信）。Botトークンで認証し、curlで直接APIを叩く。トリガーワード：「チャンネル作成」「チャンネル編集」「Discord通知」「Discordチャンネル」「discord channel」「メッセージ送信」「Embed送信」。
---

# Discord Channel API

Bot Token + curl で Discord REST API を操作する手順。

## 前提

- `.env` に `DISCORD_BOT_TOKEN` が設定済み
- `projects.json` に `guildId`, `channelId`, `alertChannelId` が定義済み
- `jq` がインストール済み

## トークン読み込み

```bash
DISCORD_BOT_TOKEN=$(grep '^DISCORD_BOT_TOKEN=' .env | cut -d'=' -f2)
GUILD_ID=$(jq -r '.[0].guildId' projects.json)
```

**注意**: `source .env` はコメント行でエラーになるため `grep + cut` を使う。

## チャンネル作成

```bash
curl -s -X POST "https://discord.com/api/v10/guilds/$GUILD_ID/channels" \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "チャンネル名", "type": 0, "topic": "説明文"}' | jq '.'
```

| type | 種類 |
|------|------|
| 0 | テキスト |
| 2 | ボイス |
| 4 | カテゴリ |
| 5 | アナウンス |
| 15 | フォーラム |

Botに **「チャンネルの管理」** 権限が必要。`Missing Permissions` が返る場合はサーバー設定でBotロールに権限付与。

## チャンネル編集

```bash
curl -s -X PATCH "https://discord.com/api/v10/channels/$CHANNEL_ID" \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "新しい名前", "topic": "新しい説明"}' | jq '.name'
```

## メッセージ送信

### プレーンテキスト

```bash
curl -s -X POST "https://discord.com/api/v10/channels/$CHANNEL_ID/messages" \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "メッセージ本文"}' | jq '.id'
```

### Embed付き

```bash
PAYLOAD=$(jq -n --arg title "タイトル" --arg desc "説明" '{
  "embeds": [{
    "title": $title,
    "description": $desc,
    "color": 1055014,
    "fields": [
      {"name": "フィールド1", "value": "値1", "inline": true}
    ]
  }]
}')

curl -s -X POST "https://discord.com/api/v10/channels/$CHANNEL_ID/messages" \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" | jq '.id'
```

### ボタン付きメッセージ

```bash
PAYLOAD=$(jq -n --arg btn_id "action:payload" '{
  "content": "操作を選択してください",
  "components": [{
    "type": 1,
    "components": [{
      "type": 2,
      "style": 4,
      "label": "ボタンラベル",
      "custom_id": $btn_id
    }]
  }]
}')

curl -s -X POST "https://discord.com/api/v10/channels/$CHANNEL_ID/messages" \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" | jq '.id'
```

ボタンstyle: 1=Primary(青), 2=Secondary(灰), 3=Success(緑), 4=Danger(赤), 5=Link

## メッセージ取得

```bash
curl -s "https://discord.com/api/v10/channels/$CHANNEL_ID/messages?limit=5" \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" | jq '.[].content'
```

## チャンネル削除

```bash
curl -s -X DELETE "https://discord.com/api/v10/channels/$CHANNEL_ID" \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" | jq '.name'
```

## Embed カラー早見表

| 色 | 10進数 | 用途 |
|----|--------|------|
| 緑 | 2328630 (0x238636) | success |
| 青 | 2060267 (0x1f6feb) | info |
| 黄 | 13801762 (0xd29922) | warning |
| 赤 | 14300723 (0xda3633) | error |

## ボタン連携

ボタンの `custom_id` は `{action}:{payload}` 形式。Botの `buttonHandler.ts` で処理される。新しいアクション追加時:

1. `src/bot/theme.ts` の `CUSTOM_ID` にヘルパー追加
2. `src/bot/events/buttonHandler.ts` の `switch` にケース追加
3. ハンドラ関数を実装
