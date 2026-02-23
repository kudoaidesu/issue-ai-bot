#!/bin/bash
# PreToolUse hook: 破壊的Bashコマンドをブロック + Discord通知（停止ボタン付き）

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# 破壊的パターン検知
BLOCKED=false
PATTERN=""

if echo "$COMMAND" | grep -qiE 'git\s+push\s+.*(-f|--force)'; then
  BLOCKED=true
  PATTERN="git push --force"
elif echo "$COMMAND" | grep -qiE 'git\s+reset\s+--hard'; then
  BLOCKED=true
  PATTERN="git reset --hard"
elif echo "$COMMAND" | grep -qiE 'rm\s+-rf\s+/|rm\s+-rf\s+\.$|rm\s+-rf\s+\.\s'; then
  BLOCKED=true
  PATTERN="rm -rf (dangerous target)"
elif echo "$COMMAND" | grep -qiE 'DROP\s+TABLE|TRUNCATE'; then
  BLOCKED=true
  PATTERN="DB destructive command"
elif echo "$COMMAND" | grep -qiE 'git\s+clean\s+-f'; then
  BLOCKED=true
  PATTERN="git clean -f"
elif echo "$COMMAND" | grep -qiE 'git\s+checkout\s+\.\s*$|git\s+restore\s+\.\s*$'; then
  BLOCKED=true
  PATTERN="discard all changes"
fi

if [ "$BLOCKED" = true ]; then
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
  CMD_CLEAN=$(echo "$COMMAND" | sed 's/2>&1//g; s/>\/dev\/null//g')
  SUMMARY=""

  if echo "$COMMAND" | grep -qiE 'git\s+push.*(-f|--force)'; then
    ARGS=$(echo "$CMD_CLEAN" | awk '{found=0; for(i=1;i<=NF;i++){if(found) print $i; if($i=="push") found=1}}')
    REMOTE=""; BRANCH=""
    while read -r word; do
      case "$word" in -*) continue ;; "") continue ;; *)
        if [ -z "$REMOTE" ]; then REMOTE="$word"
        elif [ -z "$BRANCH" ]; then BRANCH="$word"; break
        fi ;;
      esac
    done <<< "$ARGS"
    if [ -n "$BRANCH" ]; then
      SUMMARY="${BRANCH} ブランチを ${REMOTE:-origin} に強制プッシュ（復元不可）"
    else
      SUMMARY="${REMOTE:-リモート} に強制プッシュ（復元不可）"
    fi

  elif echo "$COMMAND" | grep -qiE 'git\s+reset\s+--hard'; then
    TARGET=$(echo "$CMD_CLEAN" | awk '{found=0; for(i=1;i<=NF;i++){if(found && substr($i,1,2)!="--"){print $i; exit} if($i=="--hard") found=1}}')
    SUMMARY="${TARGET:-HEAD} にハードリセット（コミット前の変更が消える）"

  elif echo "$COMMAND" | grep -qiE 'rm\s+-rf'; then
    TARGET=$(echo "$CMD_CLEAN" | awk '{found=0; for(i=1;i<=NF;i++){if(found && substr($i,1,1)!="-"){print $i; exit} if($i=="rm") found=1}}')
    SUMMARY="${TARGET:-?} を強制再帰削除（復元不可）"

  elif echo "$COMMAND" | grep -qiE 'DROP\s+TABLE'; then
    TABLE=$(echo "$COMMAND" | grep -oiE 'DROP\s+TABLE\s+\S+' | awk '{print $NF}')
    SUMMARY="${TABLE:-?} テーブルを削除（復元不可）"

  elif echo "$COMMAND" | grep -qiE 'TRUNCATE'; then
    TABLE=$(echo "$COMMAND" | grep -oiE 'TRUNCATE\s+\S+' | awk '{print $NF}')
    SUMMARY="${TABLE:-?} テーブルを全件削除（復元不可）"

  elif echo "$COMMAND" | grep -qiE 'git\s+clean\s+-f'; then
    SUMMARY="未追跡ファイルを強制削除"

  elif echo "$COMMAND" | grep -qiE 'git\s+checkout\s+\.|git\s+restore\s+\.'; then
    SUMMARY="全変更を破棄（ステージング前の変更が消える）"
  fi

  # Claude Code の PID を特定（プロセスツリーを辿る）
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
      --arg pattern "$PATTERN" \
      --arg summary "${SUMMARY:-(分類不可)}" \
      --arg session "$SESSION_ID" \
      --arg context "$CONTEXT" \
      --arg pid "${CLAUDE_PID:-不明}" \
      --arg button_id "$BUTTON_ID" \
      '{
        "embeds": [{
          "title": "🚨 危険コマンドをブロックしました",
          "color": 16711680,
          "fields": [
            {"name": "コマンド", "value": ("```\n" + $cmd + "\n```"), "inline": false},
            {"name": "検知パターン", "value": $pattern, "inline": true},
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

  echo "BLOCKED: $PATTERN — このコマンドはリポジトリ保護のためブロックされました" >&2
  exit 2
fi

exit 0
