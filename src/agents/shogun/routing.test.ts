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

describe('buildShogunSystemPrompt routing coverage', () => {
  const prompt = buildShogunSystemPrompt(BASE_SNAPSHOT, '')

  // ── 基本構造 ─────────────────────────────────────────────

  it('ショーグン宣言が含まれる', () => {
    expect(prompt).toContain('ショーグン')
    expect(prompt).toContain('自分ではコードを書かない')
  })

  it('禁止事項（ポーリング禁止）が含まれる', () => {
    expect(prompt).toContain('ポーリング')
  })

  // ── issue_create / issue_implement / full_pipeline ───────

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

  // ── メモリコンテキスト ───────────────────────────────────

  it('メモリコンテキストが空の場合は「ユーザーコンテキスト」セクションを含まない', () => {
    expect(prompt).not.toContain('ユーザーコンテキスト')
  })

  it('メモリコンテキストがある場合は「ユーザーコンテキスト」セクションを含む', () => {
    const p = buildShogunSystemPrompt(BASE_SNAPSHOT, 'TypeScriptが好き')
    expect(p).toContain('ユーザーコンテキスト')
    expect(p).toContain('TypeScriptが好き')
  })

  // ── プロジェクトが存在しない場合のフォールバック ─────────

  it('プロジェクトが空の場合は <repo> フォールバックが使われる', () => {
    const emptySnapshot: ShogunSnapshot = { ...BASE_SNAPSHOT, projects: [] }
    const p = buildShogunSystemPrompt(emptySnapshot, '')
    expect(p).toContain('<repo>')
  })
})
