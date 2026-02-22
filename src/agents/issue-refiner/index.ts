import { config } from '../../config.js'
import { runClaudeCli } from '../../llm/claude-cli.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('issue-refiner')

const SYSTEM_PROMPT = `あなたはGitHub Issueを作成するための精緻化AIです。
ユーザーからの曖昧なリクエスト（バグ報告、機能要望、メモなど）を受け取り、
構造化されたGitHub Issueに変換します。

## ルール

1. 情報が不足している場合は、具体的な質問を3つ以内で返してください。
2. 十分な情報が揃ったら、構造化されたIssueを生成してください。
3. 質問は日本語で、簡潔に。

## 応答フォーマット

### 情報不足の場合
以下のJSONのみを返してください:
{"status":"needs_info","questions":["質問1","質問2"]}

### Issue生成可能な場合
以下のJSONのみを返してください:
{"status":"ready","title":"Issueのタイトル","body":"Issueの本文（Markdown形式）","labels":["label1","label2"]}

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

export type RefinerResult =
  | { status: 'needs_info'; questions: string[] }
  | { status: 'ready'; title: string; body: string; labels: string[] }

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

const conversations = new Map<string, ConversationMessage[]>()

export async function refineIssue(
  sessionId: string,
  userMessage: string,
): Promise<RefinerResult> {
  let history = conversations.get(sessionId)
  if (!history) {
    history = []
    conversations.set(sessionId, history)
  }

  history.push({ role: 'user', content: userMessage })

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

  history.push({ role: 'assistant', content: response.content })

  const result = parseResponse(response.content)

  if (result.status === 'ready') {
    conversations.delete(sessionId)
    log.info(`Session ${sessionId}: Issue ready — "${result.title}"`)
  } else {
    log.info(
      `Session ${sessionId}: needs info — ${result.questions.length} questions`,
    )
  }

  return result
}

export function clearSession(sessionId: string): void {
  conversations.delete(sessionId)
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
        return {
          status: 'ready',
          title: obj.title,
          body: obj.body,
          labels: obj.labels as string[],
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
