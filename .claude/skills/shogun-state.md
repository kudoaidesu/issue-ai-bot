# ショーグン状態スナップショット

ショーグンエージェントが意図分類・委任判断を行う際に、システム全体の状態を
一括取得するためのスキル。**全指示の受付前にこのスナップショットを取得する。**

---

## 取得できる状態一覧

| カテゴリ | 内容 | 取得元 |
|---------|------|--------|
| **キュー** | 待機/実行中/完了/失敗件数、実行中ジョブの詳細、待機リスト | `data/queue.json` |
| **ロック状態** | 現在タスクが実行中か（新規受付可否） | インメモリ |
| **Cronスケジュール** | 登録済みジョブ名とcron式 | インメモリ |
| **LLM使用量** | Claude/Codex の使用率・残量・リセット時刻 | `data/usage.jsonl` |
| **アラート状態** | どのアラートが現在発火しているか | `data/alert-state.json` |
| **登録プロジェクト** | slug, repo, guildId, localPath 一覧 | `src/projects.json` |
| **アクティブセッション** | 現在進行中のチャットセッション一覧 | インメモリ |
| **操作履歴** | 直近20件の監査ログ（audit.jsonl） | `data/audit.jsonl` |
| **永続メモリ** | MEMORY.md の内容（ユーザーの好み・ルール等） | `data/memory/{guildId}/MEMORY.md` |
| **デイリーログ** | 本日・昨日の作業ログ | `data/memory/{guildId}/YYYY-MM-DD.md` |

**GitHub情報（オンデマンド取得）:**
キューに含まれない情報は `gh` CLI で取得する。スナップショットに含まない理由はAPIコール遅延を避けるため。

---

## 使い方

### TypeScript から呼び出す

```typescript
import { getShogunSnapshot, formatSnapshotForPrompt } from '../../agents/shogun/state.js'

// guildId を渡すとメモリ・セッションをそのギルドに絞る
const snapshot = getShogunSnapshot(guildId)

// プロンプトへの埋め込み用テキストに変換
const stateText = formatSnapshotForPrompt(snapshot)
```

### プロンプトへの組み込みパターン

```typescript
const systemPrompt = `
あなたはショーグン（将軍）である。
ユーザーの全指示を受け取り、意図を分類して配下に委任する。自分では実行しない。

${formatSnapshotForPrompt(snapshot)}

## 禁止事項
- 自分でコードを書かない（タイチョーに委任）
- 自分でIssueを作らない（トリさんに委任）
- ポーリングしない
`
```

---

## スナップショットの構造

```typescript
interface ShogunSnapshot {
  timestamp: string

  queue: {
    stats: { pending: number; processing: number; completed: number; failed: number; total: number }
    pendingItems: QueueItem[]      // 未処理ジョブ
    processingItem: QueueItem | null  // 実行中ジョブ
    isLocked: boolean              // true = 新規実行不可
  }

  projects: Array<{
    slug: string       // プロジェクト識別子
    repo: string       // "owner/repo"
    guildId: string    // Discord サーバーID
    channelId: string  // メインチャンネルID
    localPath: string  // ローカルクローンパス
  }>

  cron: {
    tasks: Array<{ name: string; schedule: string }>
    // 例: { name: "queue-process", schedule: "0 1 * * *" }
    // 例: { name: "usage-scrape",  schedule: "*/20 * * * *" }
    // 例: { name: "daily-usage-status", schedule: "0 18 * * *" }
  }

  llmUsage: {
    claude: {
      sessionPercent: number | null      // 5時間セッション使用率 (0-100)
      remaining: string | null           // 例: "4時間19分"
      weeklyAllPercent: number | null    // 週間・全モデル使用率
      weeklySonnetPercent: number | null // 週間・Sonnet使用率
    } | null
    codex: {
      usagePercent: number | null  // 週間使用率
      resetAt: string | null       // リセット日時
    } | null
    alerts: {
      sessionRateLimited: boolean   // セッション上限到達
      wakeTimeConflict: boolean     // 起床時刻(09:00)までに回復しない
      weeklyPaceExceeded: boolean   // 週間ペース超過
      sonnetPaceExceeded: boolean   // Sonnetペース超過
      codexPaceExceeded: boolean    // Codexペース超過
    }
    lastUpdated: string | null  // 最終スクレイプ時刻
  }

  activeSessions: SessionEntry[]  // アクティブなチャットセッション

  recentAudit: AuditEntry[]  // 直近20件の操作履歴

  memory: {
    permanentMemory: string  // MEMORY.md の内容
    dailyLog: string         // 本日・昨日のログ
  } | null
}
```

---

## GitHub情報のオンデマンド取得

スナップショットに含まれない GitHub 情報は gh CLI で取得する:

```bash
# 特定Issue の詳細
gh issue view <number> --repo <owner/repo> --json number,title,state,body,labels

# オープンIssue 一覧（直近10件）
gh issue list --repo <owner/repo> --state open --limit 10 --json number,title,labels,createdAt

# PRの状態
gh pr list --repo <owner/repo> --state open --json number,title,isDraft,url

# 特定ブランチのPR
gh pr view --repo <owner/repo> <branch-or-number> --json number,title,state,isDraft,url
```

---

## ショーグンの意図分類マップ

スナップショットを元にした分類判断基準:

| intent | 条件・手がかり | 委任先 |
|--------|-------------|--------|
| `issue_create` | 新しいタスクの説明、「して」「作って」「追加して」 | トリさん |
| `issue_implement` | 「Issue #N を実装して」「タイチョーで」「PR上げて」 | タイチョー |
| `full_pipeline` | 「調査して→実装して→テストして→PR」 | タイチョー (shogun strategy) |
| `status_check` | 「進捗」「状況」「どうなってる」「教えて」 | スナップショット参照 → 即答 |
| `info_query` | 「Issue #N を教えて」「Cronは？」「何件ある？」 | スナップショット + gh CLI → 即答 |
| `config_change` | 「Cronを〜に変更」「モデルを変えて」 | 設定変更ハンドラ |
| `discord_action` | 「チャンネルを作って」「投稿して」 | Discord API |
| `bug_immediate` | 「おかしい」「動かない」「なぜか〜」 urgency=immediate | タイチョー (即時) |
| `confirm_execute` | 「作っていいよ」「進めて」「OK」「やって」 | ペンディングアクション実行 |
| `memory` | 「覚えておいて」「記録して」「メモ」 | memory システム |
| `bot_control` | 「再起動」「止めて」「ログ確認」 | restart-bot スキル |
| `general_chat` | 上記に当てはまらない質問・雑談 | LLM 直接応答 |

---

## キュー状態に基づく判断

```
isLocked = true  → 「現在 Issue #N を実装中。完了後にキューに追加します」
pendingItems > 0 → キューに追加 (enqueue) して「キューに追加しました（N番目）」
pendingItems = 0 かつ !isLocked → 即時実行可能 (processImmediate)
```

## LLM使用量に基づく判断

```
sessionPercent >= 80% → 実装系タスクは「残量不足のため夜間バッチに回します」
alerts.sessionRateLimited = true → 「現在レート制限中。後で処理します」
claude = null → スクレイプ未実施（起動直後）
```
