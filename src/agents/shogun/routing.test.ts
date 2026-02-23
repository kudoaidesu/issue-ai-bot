import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// guildChat.ts の依存モジュールをすべてモック
// ---------------------------------------------------------------------------

vi.mock('discord.js', () => ({}))
vi.mock('../../config.js', () => ({
  findProjectByGuildId: vi.fn(),
  config: { projects: [] },
}))
vi.mock('../../llm/claude-sdk.js', () => ({
  runClaudeSdk: vi.fn(),
}))
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('../../utils/sanitize.js', () => ({
  sanitizePromptInput: vi.fn((s: string) => s),
  validateDiscordInput: vi.fn(() => ({ valid: true, sanitized: '' })),
}))
vi.mock('../../bot/chat-model.js', () => ({
  resolveChatModel: vi.fn(),
  parseModelPrefix: vi.fn(),
}))
vi.mock('../../memory/index.js', () => ({
  getMemoryContext: vi.fn(),
  saveConversation: vi.fn(),
}))
vi.mock('../../session/index.js', () => ({
  getSession: vi.fn(),
  createSession: vi.fn(),
  updateSessionActivity: vi.fn(),
  deleteSession: vi.fn(),
}))
vi.mock('./state.js', () => ({
  getShogunSnapshot: vi.fn(),
  formatSnapshotForPrompt: vi.fn(() => '## システム状態 (テスト)\n- キュー: 0件'),
}))

import { buildShogunSystemPrompt } from '../../bot/events/guildChat.js'
import type { ShogunSnapshot } from './state.js'

// ---------------------------------------------------------------------------
// テスト用スナップショット
// ---------------------------------------------------------------------------

const BASE_SNAPSHOT: ShogunSnapshot = {
  timestamp: '2026-02-23T05:00:00.000Z',
  queue: {
    stats: { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 },
    pendingItems: [],
    processingItem: null,
    isLocked: false,
  },
  projects: [
    {
      slug: 'issue-ai-bot',
      repo: 'owner/issue-ai-bot',
      guildId: 'g1',
      channelId: 'c1',
      localPath: '/path',
    },
  ],
  cron: { tasks: [] },
  llmUsage: {
    claude: null,
    codex: null,
    alerts: {
      sessionRateLimited: false,
      wakeTimeConflict: false,
      weeklyPaceExceeded: false,
      sonnetPaceExceeded: false,
      codexPaceExceeded: false,
    },
    lastUpdated: null,
  },
  activeSessions: [],
  recentAudit: [],
  memory: null,
}

// ---------------------------------------------------------------------------
// buildShogunSystemPrompt ルーティングカバレッジ
// ---------------------------------------------------------------------------

const TEST_GUILD_ID = 'guild-test-123'

describe('buildShogunSystemPrompt routing coverage', () => {
  const prompt = buildShogunSystemPrompt(BASE_SNAPSHOT, '', TEST_GUILD_ID)

  // ── 基本構造 ─────────────────────────────────────────────

  it('ショーグン宣言が含まれる', () => {
    expect(prompt).toContain('ショーグン')
    expect(prompt).toContain('自分ではコードを書かない')
  })

  it('禁止事項（ポーリング禁止）が含まれる', () => {
    expect(prompt).toContain('ポーリング')
  })

  // ── issue_create ─────────────────────────────────────────

  it('[issue_create] gh issue create ルートが含まれる', () => {
    expect(prompt).toContain('gh issue create')
    expect(prompt).toContain('owner/issue-ai-bot') // repo が展開されている
  })

  it('[issue_create] enqueue.ts へのキュー登録ルートが含まれる', () => {
    expect(prompt).toContain('npx tsx scripts/enqueue.ts')
  })

  it('[issue_create] ユーザーへの報告指示が含まれる', () => {
    expect(prompt).toContain('Issue #N を作成しキューに追加しました')
  })

  // ── issue_implement（既存Issue番号あり） ──────────────────

  it('[issue_implement] Issue番号ありの場合はキュー登録のみ（Issue作成不要）の指示が含まれる', () => {
    expect(prompt).toContain('Issue作成は不要')
    expect(prompt).toContain('キュー登録だけ行う')
  })

  it('[issue_implement] 既存Issueへの報告文言が含まれる', () => {
    expect(prompt).toContain('Issue #N をキューに追加しました')
  })

  // ── bug_immediate（緊急処理） ─────────────────────────────

  it('[bug_immediate] 緊急処理セクションが含まれる', () => {
    expect(prompt).toContain('緊急処理')
    expect(prompt).toContain('至急')
  })

  it('[bug_immediate] process-immediate.ts CLI ルートが含まれる', () => {
    expect(prompt).toContain('npx tsx scripts/process-immediate.ts')
  })

  it('[bug_immediate] ロック中のフォールバック説明が含まれる', () => {
    expect(prompt).toContain('高優先度キュー')
  })

  // ── status_check ─────────────────────────────────────────

  it('[status_check] スナップショット参照による即答指示が含まれる', () => {
    expect(prompt).toContain('スナップショット')
    expect(prompt).toContain('即答')
  })

  it('[status_check] isLocked 状態の説明ルートが含まれる', () => {
    expect(prompt).toContain('isLocked=true')
    expect(prompt).toContain('実装中')
  })

  it('[status_check] pendingItems の説明ルートが含まれる', () => {
    expect(prompt).toContain('pendingItems')
  })

  // ── info_query ───────────────────────────────────────────

  it('[info_query] gh issue view ルートが含まれる', () => {
    expect(prompt).toContain('gh issue view')
  })

  it('[info_query] gh issue list ルートが含まれる', () => {
    expect(prompt).toContain('gh issue list')
  })

  it('[info_query] gh pr list ルートが含まれる', () => {
    expect(prompt).toContain('gh pr list')
  })

  // ── confirm_execute ──────────────────────────────────────

  it('[confirm_execute] 「作っていいよ」承認ルートが含まれる', () => {
    expect(prompt).toContain('作っていいよ')
  })

  it('[confirm_execute] 「進めて」承認ルートが含まれる', () => {
    expect(prompt).toContain('進めて')
  })

  it('[confirm_execute] 前の提案を実行する指示が含まれる', () => {
    expect(prompt).toContain('直前の提案')
  })

  // ── memory ───────────────────────────────────────────────

  it('[memory] 「覚えておいて」ルートが含まれる', () => {
    expect(prompt).toContain('覚えておいて')
  })

  it('[memory] MEMORY.md への書き込みコマンドが含まれる', () => {
    expect(prompt).toContain('MEMORY.md')
  })

  // ── bot_control ──────────────────────────────────────────

  it('[bot_control] 「再起動」ルートが含まれる', () => {
    expect(prompt).toContain('再起動')
  })

  it('[bot_control] restart-bot スキルへの委任が含まれる', () => {
    expect(prompt).toContain('restart-bot')
  })

  // ── general_chat ─────────────────────────────────────────

  it('[general_chat] 雑談フォールバックが含まれる', () => {
    expect(prompt).toContain('雑談')
  })

  it('[general_chat] 2000文字制限が含まれる', () => {
    expect(prompt).toContain('2000文字')
  })

  // ── プロジェクト情報 ─────────────────────────────────────

  it('登録プロジェクト一覧が含まれる', () => {
    expect(prompt).toContain('issue-ai-bot')
    expect(prompt).toContain('owner/issue-ai-bot')
  })

  // ── スナップショット埋め込み ─────────────────────────────

  it('システム状態テキストが含まれる（formatSnapshotForPrompt の出力）', () => {
    expect(prompt).toContain('システム状態')
  })

  // ── guildId 埋め込み ──────────────────────────────────────

  it('MEMORY.md 書き込みコマンドに実際の guildId が含まれる', () => {
    expect(prompt).toContain(`data/memory/${TEST_GUILD_ID}/MEMORY.md`)
  })

  it('MEMORY.md 書き込みに printf が使われる（echo より安全）', () => {
    expect(prompt).toContain("printf '%s\\n'")
  })

  // ── メモリコンテキスト ───────────────────────────────────

  it('メモリコンテキストが空の場合は「ユーザーコンテキスト」セクションを含まない', () => {
    expect(prompt).not.toContain('ユーザーコンテキスト')
  })

  it('メモリコンテキストがある場合は「ユーザーコンテキスト」セクションを含む', () => {
    const p = buildShogunSystemPrompt(BASE_SNAPSHOT, 'TypeScriptが好き', TEST_GUILD_ID)
    expect(p).toContain('ユーザーコンテキスト')
    expect(p).toContain('TypeScriptが好き')
  })

  // ── プロジェクトが存在しない場合のフォールバック ─────────

  it('プロジェクトが空の場合は <repo> フォールバックが使われる', () => {
    const emptySnapshot: ShogunSnapshot = { ...BASE_SNAPSHOT, projects: [] }
    const p = buildShogunSystemPrompt(emptySnapshot, '', TEST_GUILD_ID)
    expect(p).toContain('<repo>')
  })
})
