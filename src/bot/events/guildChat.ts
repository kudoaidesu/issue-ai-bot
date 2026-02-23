import { type Message } from 'discord.js'
import { findProjectByGuildId, type ProjectConfig } from '../../config.js'
import { runClaudeSdk, type ClaudeSdkResult } from '../../llm/claude-sdk.js'
import { createLogger } from '../../utils/logger.js'
import { sanitizePromptInput, validateDiscordInput } from '../../utils/sanitize.js'
import { resolveChatModel, parseModelPrefix } from '../chat-model.js'
import { getMemoryContext, saveConversation } from '../../memory/index.js'
import {
  getSession,
  createSession,
  updateSessionActivity,
  deleteSession,
} from '../../session/index.js'
import { getShogunSnapshot, formatSnapshotForPrompt } from '../../agents/shogun/state.js'

const log = createLogger('guild-chat')

// ---------------------------------------------------------------------------
// ショーグン システムプロンプト
// ---------------------------------------------------------------------------

export function buildShogunSystemPrompt(
  snapshot: ReturnType<typeof getShogunSnapshot>,
  memoryContext: string,
): string {
  const stateText = formatSnapshotForPrompt(snapshot)
  const repoList = snapshot.projects.map((p) => `${p.slug}: ${p.repo}`).join(', ')

  return `あなたはショーグン（将軍）である。
ユーザーの全指示を受け取り、意図を分類して配下エージェントに委任する。**自分ではコードを書かない。**

## 禁止事項
- 直接コードを実装・変更する（タイチョーに委任）
- 確認なく設定を変更する
- ポーリング（APIを繰り返し叩いて待機する）

## 委任マップ

### 新規タスク・実装指示
1. gh issue create でIssueを作成する
   例: gh issue create --repo ${snapshot.projects[0]?.repo ?? '<repo>'} --title "..." --body "..."
2. npx tsx scripts/enqueue.ts <issueNumber> <repo> [high|medium|low] でキューに登録する
3. Codexレビューが必要な場合は codex-review スキルに従い mcp__codex-mcp__codex でレビューを挟む
4. ユーザーに「Issue #N を作成しキューに追加しました」と報告する

### 進捗・状態確認
- 下記スナップショットの情報を参照して即答する（ツール呼び出し不要）
- isLocked=true なら「現在 Issue #N を実装中」と伝える
- pendingItems があれば件数と内容を伝える

### Issue・PR情報照会
- gh issue view <N> --repo <repo> --json number,title,state,body,labels
- gh issue list --repo <repo> --state open --limit 10
- gh pr list --repo <repo> --state open

### 承認・実行確認（「作っていいよ」「進めて」「OK」「やって」）
- セッション内の直前の提案をそのまま実行に移す
- 提案が曖昧なら「何を実行しますか？」と確認する

### 記憶保存（「覚えておいて」「メモして」）
- MEMORY.md に記録する: bash -c "echo '<内容>' >> data/memory/<guildId>/MEMORY.md"
- 「記録しました」と返す

### ボット制御（「再起動」「ログ確認」）
- restart-bot スキルの手順に従う

### 雑談・Q&A
- 上記に当てはまらない場合は日本語で簡潔に回答する（2000文字以内）

## 登録プロジェクト
${repoList}

${stateText}

${memoryContext ? `## ユーザーコンテキスト\n${memoryContext}` : ''}`.trim()
}

/** resume セッション時に先頭に付与するコンパクトな状態更新テキスト */
function buildStateRefreshPrefix(snapshot: ReturnType<typeof getShogunSnapshot>): string {
  const ts = new Date(snapshot.timestamp).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' })
  const q = snapshot.queue
  const lockStr = q.isLocked
    ? `🔒 実行中: Issue #${q.processingItem?.issueNumber ?? '?'}`
    : `🔓 空き`
  const usage = snapshot.llmUsage.claude
    ? `Claude ${snapshot.llmUsage.claude.sessionPercent ?? '?'}%`
    : 'Claude: データなし'
  const alerts = Object.entries(snapshot.llmUsage.alerts)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ')

  const lines = [
    `[状態更新 ${ts}]`,
    `キュー: 待機${q.stats.pending}件 | ${lockStr}`,
    `LLM: ${usage}${alerts ? ` ⚠️ ${alerts}` : ''}`,
    '---',
    '',
  ]
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// セッション作成
// ---------------------------------------------------------------------------

async function createNewSession(
  guildId: string,
  channelId: string,
  sanitized: string,
  model: string,
  project: ProjectConfig,
): Promise<ClaudeSdkResult> {
  const snapshot = getShogunSnapshot(guildId)
  const memoryContext = await getMemoryContext(guildId, channelId, sanitized)

  const systemPrompt = buildShogunSystemPrompt(snapshot, memoryContext ?? '')

  const result = await runClaudeSdk({
    prompt: sanitized,
    systemPrompt,
    model,
    maxTurns: 10,
    cwd: project.localPath,
    settingSources: ['project'],
    permissionMode: 'bypassPermissions',
    timeoutMs: 180_000,
  })

  if (result.sessionId) {
    createSession({
      sessionId: result.sessionId,
      channelId,
      guildId,
      summary: sanitized.slice(0, 200),
      model,
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// メインハンドラ
// ---------------------------------------------------------------------------

export async function handleGuildChat(message: Message): Promise<void> {
  if (!message.guild) return
  if (message.author.bot) return

  let content = message.content.replace(/<@!?\d+>/g, '').trim()
  if (!content) return

  const project = findProjectByGuildId(message.guild.id)
  if (!project) {
    log.warn(`Unknown guild: ${message.guild.id}`)
    return
  }

  const { model: messageModelOverride, content: strippedContent } = parseModelPrefix(content)
  content = strippedContent
  if (!content) return

  const validation = validateDiscordInput(content)
  if (!validation.valid) return
  const sanitized = sanitizePromptInput(validation.sanitized)

  const model = resolveChatModel(message.guild.id, messageModelOverride)
  const guildId = message.guild.id
  const channelId = message.channel.id

  log.info(`Shogun received from ${message.author.tag} (model=${model}): "${sanitized.slice(0, 50)}..."`)

  try {
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping()
    }

    let result: ClaudeSdkResult
    const existingSession = getSession(channelId)

    if (existingSession) {
      // 既存セッションを resume — 先頭にコンパクトな状態更新を付与
      try {
        const snapshot = getShogunSnapshot(guildId)
        const statePrefix = buildStateRefreshPrefix(snapshot)
        result = await runClaudeSdk({
          prompt: statePrefix + sanitized,
          model,
          resume: existingSession.sessionId,
          maxTurns: 10,
          cwd: project.localPath,
          permissionMode: 'bypassPermissions',
          timeoutMs: 180_000,
        })
        updateSessionActivity(channelId, sanitized.slice(0, 200))
        log.info(`Resumed session ${existingSession.sessionId.slice(0, 12)}...`)
      } catch (err) {
        log.warn(`Session resume failed, creating new session: ${err}`)
        deleteSession(channelId)
        result = await createNewSession(guildId, channelId, sanitized, model, project)
      }
    } else {
      result = await createNewSession(guildId, channelId, sanitized, model, project)
    }

    // SDK が 0 文字を返した場合（ツール実行のみで終わった場合）、要約を要求する
    if (!result.content && result.sessionId) {
      log.info(`SDK returned 0 chars, requesting summary from session ${result.sessionId.slice(0, 12)}...`)
      try {
        const summaryResult = await runClaudeSdk({
          prompt: '今の操作の結果を日本語で簡潔に教えてください。',
          model,
          resume: result.sessionId,
          maxTurns: 1,
          cwd: project.localPath,
          permissionMode: 'bypassPermissions',
          timeoutMs: 30_000,
        })
        result = summaryResult
      } catch (err) {
        log.warn(`Summary request failed: ${err}`)
      }
    }

    const reply = result.content.slice(0, 2000)
    await message.reply(reply || '処理は完了しましたが、返答内容を取得できませんでした。')

    // 会話をメモリに保存
    const now = new Date().toISOString()
    await saveConversation(guildId, channelId, [
      {
        role: 'user',
        userId: message.author.id,
        username: message.author.tag,
        content: sanitized,
        timestamp: now,
      },
      { role: 'assistant', content: result.content, timestamp: now },
    ])
  } catch (err) {
    log.error('Shogun failed', err)
    await message.reply('すみません、応答の生成に失敗しました。')
  }
}
