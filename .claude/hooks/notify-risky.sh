#!/bin/bash
# PostToolUse hook: リスク操作を Discord に事後通知（停止ボタン付き）

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# リスクパターン検知
RISKY=false
CATEGORY=""

if echo "$COMMAND" | grep -qiE 'git\s+push(\s|$)'; then
  RISKY=true
  CATEGORY="git push"
elif echo "$COMMAND" | grep -qiE 'git\s+branch\s+-[dD]'; then
  RISKY=true
  CATEGORY="branch delete"
elif echo "$COMMAND" | grep -qiE 'npm\s+publish'; then
  RISKY=true
  CATEGORY="npm publish"
elif echo "$COMMAND" | grep -qiE 'git\s+merge'; then
  RISKY=true
  CATEGORY="git merge"
elif echo "$COMMAND" | grep -qiE 'git\s+rebase'; then
  RISKY=true
  CATEGORY="git rebase"
elif echo "$COMMAND" | grep -qiE 'rm\s+-r'; then
  RISKY=true
  CATEGORY="recursive delete"
fi

if [ "$RISKY" = true ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

  SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
  TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

  # 作業コンテキスト取得
  # type=="user" の最後のテキストメッセージを取得、システム注入（<で始まる）を除外
  CONTEXT="(取得不可)"
  if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
    CONTEXT=$(jq -rs '[.[] | select(.type == "user") | .message.content[]? | select(.type == "text") | .text | select(startswith("<") | not)] | last // ""' "$TRANSCRIPT_PATH" 2>/dev/null | head -c 200)
    [ -z "$CONTEXT" ] && CONTEXT="(取得不可)"
  fi

  # コマンドの補足説明（人が読みやすい形式）
  # シェルリダイレクト記号を除去してからパース
  CMD_CLEAN=$(echo "$COMMAND" | sed 's/2>&1//g; s/>\/dev\/null//g')
  SUMMARY=""

  if echo "$COMMAND" | grep -qiE 'git\s+push'; then
    ARGS=$(echo "$CMD_CLEAN" | awk '{found=0; for(i=1;i<=NF;i++){if(found) print $i; if($i=="push") found=1}}')
    REMOTE=""; BRANCH=""
    while read -r word; do
      case "$word" in -*) continue ;; "") continue ;; *)
        if [ -z "$REMOTE" ]; then REMOTE="$word"
        elif [ -z "$BRANCH" ]; then BRANCH="$word"; break
        fi ;;
      esac
    done <<< "$ARGS"
    if [ -n "$BRANCH" ] && [ -n "$REMOTE" ]; then
      SUMMARY="${BRANCH} ブランチを ${REMOTE} にプッシュ"
    elif [ -n "$REMOTE" ]; then
      SUMMARY="${REMOTE} にプッシュ"
    else
      SUMMARY="リモートにプッシュ"
    fi

  elif echo "$COMMAND" | grep -qiE 'git\s+branch\s+-[dD]'; then
    BRANCH=$(echo "$CMD_CLEAN" | awk '{for(i=1;i<=NF;i++) if($i~/^-[dD]$/) {print $(i+1); exit}}')
    SUMMARY="${BRANCH:-?} ブランチを削除"

  elif echo "$COMMAND" | grep -qiE 'npm\s+publish'; then
    SUMMARY="パッケージを npm に公開"

  elif echo "$COMMAND" | grep -qiE 'git\s+merge'; then
    TARGET=$(echo "$CMD_CLEAN" | awk '{found=0; for(i=1;i<=NF;i++){if(found && substr($i,1,1)!="-"){print $i; exit} if($i=="merge") found=1}}')
    SUMMARY="${TARGET:-?} をマージ"

  elif echo "$COMMAND" | grep -qiE 'git\s+rebase'; then
    TARGET=$(echo "$CMD_CLEAN" | awk '{found=0; for(i=1;i<=NF;i++){if(found && substr($i,1,1)!="-"){print $i; exit} if($i=="rebase") found=1}}')
    SUMMARY="${TARGET:-?} にリベース"

  elif echo "$COMMAND" | grep -qiE 'rm\s+-r'; then
    TARGET=$(echo "$CMD_CLEAN" | awk '{found=0; for(i=1;i<=NF;i++){if(found && substr($i,1,1)!="-"){print $i; exit} if($i=="rm") found=1}}')
    SUMMARY="${TARGET:-?} を再帰的に削除"
  fi

  # Claude Code PID 特定
  CLAUDE_PID=""
  WALK_PID=$$
  for _ in $(seq 1 10); do
    CMD=$(ps -o command= -p "$WALK_PID" 2>/dev/null || true)
    if echo "$CMD" | grep -q "claude"; then
      CLAUDE_PID=$WALK_PID
      break
    fi
    WALK_PID=$(ps -o ppid= -p "$WALK_PID" 2>/dev/null | tr -d ' ')
    [ -z "$WALK_PID" ] && break
  done

  DISCORD_BOT_TOKEN=""
  if [ -f "$PROJECT_DIR/.env" ]; then
    DISCORD_BOT_TOKEN=$(grep '^DISCORD_BOT_TOKEN=' "$PROJECT_DIR/.env" | cut -d'=' -f2)
  fi

  CHANNEL_ID=$(jq -r '.[0].operationAlertChannelId // empty' "$PROJECT_DIR/projects.json" 2>/dev/null)

  if [ -n "$DISCORD_BOT_TOKEN" ] && [ -n "$CHANNEL_ID" ]; then
    BUTTON_ID="kill_session:${CLAUDE_PID:-unknown}"

    PAYLOAD=$(jq -n \
      --arg cmd "$COMMAND" \
      --arg cat "$CATEGORY" \
      --arg summary "${SUMMARY:-(分類不可)}" \
      --arg session "$SESSION_ID" \
      --arg context "$CONTEXT" \
      --arg pid "${CLAUDE_PID:-不明}" \
      --arg button_id "$BUTTON_ID" \
      '{
        "embeds": [{
          "title": "⚠️ リスク操作を実行しました",
          "color": 16776960,
          "fields": [
            {"name": "コマンド", "value": ("```\n" + $cmd + "\n```"), "inline": false},
            {"name": "カテゴリ", "value": $cat, "inline": true},
            {"name": "PID", "value": $pid, "inline": true},
            {"name": "補足", "value": $summary, "inline": false},
            {"name": "セッション", "value": $session, "inline": false},
            {"name": "作業内容", "value": $context, "inline": false}
          ]
        }],
        "components": [{
          "type": 1,
          "components": [{
            "type": 2,
            "style": 4,
            "label": "セッションを停止",
            "custom_id": $button_id
          }]
        }]
      }')

    curl -s -X POST "https://discord.com/api/v10/channels/$CHANNEL_ID/messages" \
      -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" > /dev/null 2>&1 &
  fi
fi

exit 0
