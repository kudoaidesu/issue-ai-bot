import { config } from '../../config.js'
import { runClaudeCli } from '../../llm/claude-cli.js'
import { createLogger } from '../../utils/logger.js'
import {
  appendSessionMessage,
  getSessionConversation,
  deleteSession,
} from '../../memory/index.js'

const log = createLogger('issue-refiner')

const SYSTEM_PROMPT = `あなたはGitHub Issueを作成するための精緻化AIです。
ユーザーからの曖昧なリクエスト（バグ報告、機能要望、メモなど）を受け取り、
構造化されたGitHub Issueに変換します。

## ルール

1. 情報が不足している場合は、具体的な質問を3つ以内で返してください。
2. 十分な情報が揃ったら、構造化されたIssueを生成してください。
3. 質問は日本語で、簡潔に。
4. Issue生成時に、緊急度（urgency）を判定してください:
   - "immediate": 調査依頼、確認作業、即時性のあるタスク。キーワード例: 「すぐ」「調べて」「確認して」「チェックして」「至急」「今すぐ」「調査」「原因を探って」
   - "queued": 機能追加、リファクタリング、ドキュメント作成、設計変更など、じっくり取り組むタスク

## 応答フォーマット

### 情報不足の場合
以下のJSONのみを返してください:
{"status":"needs_info","questions":["質問1","質問2"]}

### Issue生成可能な場合
以下のJSONのみを返してください:
{"status":"ready","title":"Issueのタイトル","body":"Issueの本文（Markdown形式）","labels":["label1","label2"],"urgency":"immediate or queued"}

## Issue本文のテンプレート

## 概要
[1-2行の要約]

## 背景・目的
[なぜこの変更が必要か]

## 要件
- [ ] 要件1
- [ ] 要件2

## 受け入れ条件
- [ ] 条件1
- [ ] 条件2

## 技術メモ
[関連ファイル、影響範囲など]

## ラベルの選択肢
- bug（バグ修正）
- enhancement（機能追加・改善）
- docs（ドキュメント）
- refactor（リファクタリング）
- test（テスト追加）
- priority:high / priority:medium / priority:low

必ずJSONのみを返してください。余分なテキストやマークダウンフェンスは不要です。`

export type Urgency = 'immediate' | 'queued'

export type RefinerResult =
  | { status: 'needs_info'; questions: string[] }
  | { status: 'ready'; title: string; body: string; labels: string[]; urgency: Urgency }

// フォールバック用のインメモリキャッシュ（メモリシステム無効時）
const conversationsFallback = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>()

export async function refineIssue(
  sessionId: string,
  userMessage: string,
): Promise<RefinerResult> {
  // セッション会話をディスクから読み込み
  let history = config.memory.enabled
    ? getSessionConversation(sessionId)
    : (conversationsFallback.get(sessionId) ?? [])

  if (!config.memory.enabled && !conversationsFallback.has(sessionId)) {
    conversationsFallback.set(sessionId, history)
  }

  const userMsg = { role: 'user' as const, content: userMessage, timestamp: new Date().toISOString() }
  history.push(userMsg)

  if (config.memory.enabled) {
    appendSessionMessage(sessionId, userMsg)
  }

  log.info(`Session ${sessionId}: processing "${userMessage.slice(0, 50)}..."`)

  // 会話履歴をプロンプトに含める
  const conversationContext = history
    .map((m) => `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`)
    .join('\n\n')

  const response = await runClaudeCli({
    prompt: conversationContext,
    systemPrompt: SYSTEM_PROMPT,
    model: config.llm.model,
    allowedTools: [],
  })

  const assistantMsg = { role: 'assistant' as const, content: response.content, timestamp: new Date().toISOString() }
  history.push(assistantMsg)

  if (config.memory.enabled) {
    appendSessionMessage(sessionId, assistantMsg)
  }

  const result = parseResponse(response.content)

  if (result.status === 'ready') {
    if (config.memory.enabled) {
      deleteSession(sessionId)
    } else {
      conversationsFallback.delete(sessionId)
    }
    log.info(`Session ${sessionId}: Issue ready — "${result.title}"`)
  } else {
    log.info(
      `Session ${sessionId}: needs info — ${result.questions.length} questions`,
    )
  }

  return result
}

export function clearSession(sessionId: string): void {
  if (config.memory.enabled) {
    deleteSession(sessionId)
  } else {
    conversationsFallback.delete(sessionId)
  }
}

function parseResponse(text: string): RefinerResult {
  // JSONブロック内のJSON、または直接JSONを抽出
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const jsonStr = jsonMatch ? jsonMatch[1] : text

  // 複数行にまたがるJSON文字列からJSONオブジェクトを探す
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/)
  const candidate = objectMatch ? objectMatch[0] : jsonStr

  try {
    const parsed: unknown = JSON.parse(candidate.trim())

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'status' in parsed
    ) {
      const obj = parsed as Record<string, unknown>

      if (
        obj.status === 'needs_info' &&
        Array.isArray(obj.questions)
      ) {
        return {
          status: 'needs_info',
          questions: obj.questions as string[],
        }
      }

      if (
        obj.status === 'ready' &&
        typeof obj.title === 'string' &&
        typeof obj.body === 'string' &&
        Array.isArray(obj.labels)
      ) {
        const urgency: Urgency =
          obj.urgency === 'immediate' ? 'immediate' : 'queued'
        return {
          status: 'ready',
          title: obj.title,
          body: obj.body,
          labels: obj.labels as string[],
          urgency,
        }
      }
    }
  } catch {
    log.warn(`Failed to parse AI response: ${text.slice(0, 100)}`)
  }

  return {
    status: 'needs_info',
    questions: ['すみません、うまく解析できませんでした。もう少し詳しく教えてください。'],
  }
}
