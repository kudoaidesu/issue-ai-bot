import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getShogunSnapshot, formatSnapshotForPrompt, type ShogunSnapshot } from './state.js'

// ---------------------------------------------------------------------------
// モック
// ---------------------------------------------------------------------------

vi.mock('../../queue/processor.js', () => ({
  getAll: vi.fn(),
  getStats: vi.fn(),
}))
vi.mock('../../queue/rate-limiter.js', () => ({
  isLocked: vi.fn(),
}))
vi.mock('../../queue/scheduler.js', () => ({
  getScheduledTasks: vi.fn(),
}))
vi.mock('../../utils/audit.js', () => ({
  getAuditLog: vi.fn(),
}))
vi.mock('../../utils/usage-monitor.js', () => ({
  getLatestUsage: vi.fn(),
}))
vi.mock('../../session/index.js', () => ({
  getAllSessions: vi.fn(),
  getSessionsByGuild: vi.fn(),
}))
vi.mock('../../memory/index.js', () => ({
  readMemory: vi.fn(),
}))
vi.mock('../../memory/store.js', () => ({
  readTodayAndYesterdayLogs: vi.fn(),
}))
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}))
vi.mock('../../config.js', () => ({
  config: {
    projects: [
      {
        slug: 'issue-ai-bot',
        repo: 'owner/issue-ai-bot',
        guildId: 'guild123',
        channelId: 'ch456',
        localPath: '/Users/ai_server/work/issue-ai-bot',
      },
    ],
    queue: { dataDir: '/tmp/test-data' },
  },
}))

// ---------------------------------------------------------------------------
// テストヘルパー
// ---------------------------------------------------------------------------

async function getMocks() {
  return {
    getAll: vi.mocked((await import('../../queue/processor.js')).getAll),
    getStats: vi.mocked((await import('../../queue/processor.js')).getStats),
    isLocked: vi.mocked((await import('../../queue/rate-limiter.js')).isLocked),
    getScheduledTasks: vi.mocked((await import('../../queue/scheduler.js')).getScheduledTasks),
    getAuditLog: vi.mocked((await import('../../utils/audit.js')).getAuditLog),
    getLatestUsage: vi.mocked((await import('../../utils/usage-monitor.js')).getLatestUsage),
    getAllSessions: vi.mocked((await import('../../session/index.js')).getAllSessions),
    getSessionsByGuild: vi.mocked((await import('../../session/index.js')).getSessionsByGuild),
    readMemory: vi.mocked((await import('../../memory/index.js')).readMemory),
    readTodayAndYesterdayLogs: vi.mocked((await import('../../memory/store.js')).readTodayAndYesterdayLogs),
    existsSync: vi.mocked((await import('node:fs')).existsSync),
    readFileSync: vi.mocked((await import('node:fs')).readFileSync),
  }
}

const BASE_QUEUE_ITEM = {
  id: 'item-1',
  issueNumber: 42,
  repository: 'owner/issue-ai-bot',
  priority: 'high' as const,
  status: 'pending' as const,
  createdAt: '2026-02-23T01:00:00.000Z',
}

// ---------------------------------------------------------------------------
// getShogunSnapshot
// ---------------------------------------------------------------------------

describe('getShogunSnapshot', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const m = await getMocks()
    m.getAll.mockReturnValue([])
    m.getStats.mockReturnValue({ pending: 0, processing: 0, completed: 5, failed: 1, total: 6 })
    m.isLocked.mockReturnValue(false)
    m.getScheduledTasks.mockReturnValue([
      { name: 'queue-process', schedule: '0 1 * * *' },
      { name: 'usage-scrape', schedule: '*/20 * * * *' },
      { name: 'daily-usage-status', schedule: '0 18 * * *' },
    ])
    m.getAuditLog.mockReturnValue([])
    m.getLatestUsage.mockReturnValue({ claude: null, codex: null })
    m.getAllSessions.mockReturnValue([])
    m.getSessionsByGuild.mockReturnValue([])
    m.existsSync.mockReturnValue(false)
  })

  it('スナップショットの基本構造が揃っている', async () => {
    const snapshot = getShogunSnapshot()
    expect(snapshot).toMatchObject({
      timestamp: expect.any(String),
      queue: {
        stats: { pending: 0, processing: 0, completed: 5, failed: 1, total: 6 },
        pendingItems: [],
        processingItem: null,
        isLocked: false,
      },
      projects: [{ slug: 'issue-ai-bot', repo: 'owner/issue-ai-bot' }],
      cron: {
        tasks: expect.arrayContaining([
          { name: 'queue-process', schedule: '0 1 * * *' },
        ]),
      },
      llmUsage: { claude: null, codex: null, alerts: expect.any(Object), lastUpdated: null },
      activeSessions: [],
      recentAudit: [],
      memory: null,
    })
  })

  it('実行中ジョブがある場合 processingItem と isLocked が正しく反映される', async () => {
    const m = await getMocks()
    const processingItem = { ...BASE_QUEUE_ITEM, status: 'processing' as const }
    m.getAll.mockReturnValue([processingItem])
    m.getStats.mockReturnValue({ pending: 0, processing: 1, completed: 0, failed: 0, total: 1 })
    m.isLocked.mockReturnValue(true)

    const snapshot = getShogunSnapshot()
    expect(snapshot.queue.processingItem?.issueNumber).toBe(42)
    expect(snapshot.queue.isLocked).toBe(true)
    expect(snapshot.queue.pendingItems).toHaveLength(0)
  })

  it('待機中ジョブが pendingItems に入る', async () => {
    const m = await getMocks()
    m.getAll.mockReturnValue([
      { ...BASE_QUEUE_ITEM, id: 'p1', issueNumber: 10, status: 'pending' },
      { ...BASE_QUEUE_ITEM, id: 'p2', issueNumber: 20, status: 'pending', priority: 'medium' },
    ])
    m.getStats.mockReturnValue({ pending: 2, processing: 0, completed: 0, failed: 0, total: 2 })

    const snapshot = getShogunSnapshot()
    expect(snapshot.queue.pendingItems).toHaveLength(2)
    expect(snapshot.queue.pendingItems[0].issueNumber).toBe(10)
  })

  it('guildId 指定時に getSessionsByGuild が呼ばれる', async () => {
    const m = await getMocks()
    m.getSessionsByGuild.mockReturnValue([])

    getShogunSnapshot('guild123')
    expect(m.getSessionsByGuild).toHaveBeenCalledWith('guild123')
    expect(m.getAllSessions).not.toHaveBeenCalled()
  })

  it('guildId 未指定時に getAllSessions が呼ばれる', async () => {
    const m = await getMocks()
    m.getAllSessions.mockReturnValue([])

    getShogunSnapshot()
    expect(m.getAllSessions).toHaveBeenCalled()
    expect(m.getSessionsByGuild).not.toHaveBeenCalled()
  })

  it('guildId 指定時にメモリが取得される', async () => {
    const m = await getMocks()
    m.readMemory.mockReturnValue('# MEMORY\n- TypeScriptが好き')
    m.readTodayAndYesterdayLogs.mockReturnValue('## 今日\n- テスト実施')

    const snapshot = getShogunSnapshot('guild123')
    expect(snapshot.memory).toEqual({
      permanentMemory: '# MEMORY\n- TypeScriptが好き',
      dailyLog: '## 今日\n- テスト実施',
    })
  })

  it('メモリ取得失敗時は memory が null になる', async () => {
    const m = await getMocks()
    m.readMemory.mockImplementation(() => { throw new Error('file not found') })

    const snapshot = getShogunSnapshot('guild123')
    expect(snapshot.memory).toBeNull()
  })

  it('alert-state.json が存在しない場合はデフォルト（全 false）を返す', async () => {
    const snapshot = getShogunSnapshot()
    expect(snapshot.llmUsage.alerts).toEqual({
      sessionRateLimited: false,
      wakeTimeConflict: false,
      weeklyPaceExceeded: false,
      sonnetPaceExceeded: false,
      codexPaceExceeded: false,
    })
  })

  it('alert-state.json が存在する場合は Boolean 変換して読み込む', async () => {
    const m = await getMocks()
    m.existsSync.mockReturnValue(true)
    m.readFileSync.mockReturnValue(
      JSON.stringify({ sessionRateLimited: false, wakeTimeConflict: false, weeklyPaceExceeded: false, sonnetPaceExceeded: true, codexPaceExceeded: true })
    )

    const snapshot = getShogunSnapshot()
    expect(snapshot.llmUsage.alerts.sonnetPaceExceeded).toBe(true)
    expect(snapshot.llmUsage.alerts.codexPaceExceeded).toBe(true)
    expect(snapshot.llmUsage.alerts.sessionRateLimited).toBe(false)
  })

  it('alert-state.json が不正 JSON でも defaults にフォールバックする', async () => {
    const m = await getMocks()
    m.existsSync.mockReturnValue(true)
    m.readFileSync.mockReturnValue('{ invalid json }')

    const snapshot = getShogunSnapshot()
    expect(snapshot.llmUsage.alerts.sonnetPaceExceeded).toBe(false)
  })

  it('getLatestUsage が例外を投げても llmUsage が null になる', async () => {
    const m = await getMocks()
    m.getLatestUsage.mockImplementation(() => { throw new Error('scrape failed') })

    const snapshot = getShogunSnapshot()
    expect(snapshot.llmUsage.claude).toBeNull()
    expect(snapshot.llmUsage.codex).toBeNull()
  })

  it('Claude 使用量が取得できる場合に正しくパースされる', async () => {
    const m = await getMocks()
    m.getLatestUsage.mockReturnValue({
      claude: {
        timestamp: '2026-02-23T04:40:03.322Z',
        claude: {
          session: { usagePercent: 23, remaining: '3時間59分', rateLimited: false },
          weekly: { models: [{ model: 'All', usagePercent: 18 }, { model: 'Sonnet', usagePercent: 43 }] },
        },
      },
      codex: null,
    })

    const snapshot = getShogunSnapshot()
    expect(snapshot.llmUsage.claude?.sessionPercent).toBe(23)
    expect(snapshot.llmUsage.claude?.remaining).toBe('3時間59分')
    expect(snapshot.llmUsage.claude?.weeklyAllPercent).toBe(18)
    expect(snapshot.llmUsage.claude?.weeklySonnetPercent).toBe(43)
    expect(snapshot.llmUsage.lastUpdated).toBe('2026-02-23T04:40:03.322Z')
  })
})

// ---------------------------------------------------------------------------
// formatSnapshotForPrompt
// ---------------------------------------------------------------------------

describe('formatSnapshotForPrompt', () => {
  const baseSnapshot: ShogunSnapshot = {
    timestamp: '2026-02-23T05:00:00.000Z',
    queue: {
      stats: { pending: 2, processing: 1, completed: 10, failed: 2, total: 15 },
      pendingItems: [
        { ...BASE_QUEUE_ITEM, id: 'p1', issueNumber: 10, status: 'pending' },
        { ...BASE_QUEUE_ITEM, id: 'p2', issueNumber: 20, status: 'pending', priority: 'medium' },
      ],
      processingItem: { ...BASE_QUEUE_ITEM, status: 'processing' as const },
      isLocked: true,
    },
    projects: [{ slug: 'issue-ai-bot', repo: 'owner/issue-ai-bot', guildId: 'g1', channelId: 'c1', localPath: '/path' }],
    cron: {
      tasks: [
        { name: 'queue-process', schedule: '0 1 * * *' },
        { name: 'usage-scrape', schedule: '*/20 * * * *' },
      ],
    },
    llmUsage: {
      claude: { sessionPercent: 23, remaining: '3時間59分', weeklyAllPercent: 18, weeklySonnetPercent: 43 },
      codex: { usagePercent: 74, resetAt: '2026/02/25 9:16' },
      alerts: { sessionRateLimited: false, wakeTimeConflict: false, weeklyPaceExceeded: false, sonnetPaceExceeded: true, codexPaceExceeded: true },
      lastUpdated: '2026-02-23T05:00:00.000Z',
    },
    activeSessions: [],
    recentAudit: [],
    memory: null,
  }

  it('キュー情報が含まれる', () => {
    const text = formatSnapshotForPrompt(baseSnapshot)
    expect(text).toContain('待機: 2件')
    expect(text).toContain('実行中: 1件')
    expect(text).toContain('🔒 実行中（新規タスク受付不可）')
    expect(text).toContain('Issue #42')
  })

  it('待機キューが最大5件表示される', () => {
    const manyItems = Array.from({ length: 7 }, (_, i) => ({
      ...BASE_QUEUE_ITEM,
      id: `p${i}`,
      issueNumber: i + 1,
      status: 'pending' as const,
    }))
    const snapshot = { ...baseSnapshot, queue: { ...baseSnapshot.queue, pendingItems: manyItems } }
    const text = formatSnapshotForPrompt(snapshot)
    expect(text).toContain('他 2 件')
  })

  it('Cronスケジュールが含まれる', () => {
    const text = formatSnapshotForPrompt(baseSnapshot)
    expect(text).toContain('queue-process')
    expect(text).toContain('0 1 * * *')
  })

  it('LLM使用量が含まれる', () => {
    const text = formatSnapshotForPrompt(baseSnapshot)
    expect(text).toContain('Claude: セッション 23% 使用')
    expect(text).toContain('Sonnet 43%')
    expect(text).toContain('Codex: 74%')
  })

  it('アラートが含まれる', () => {
    const text = formatSnapshotForPrompt(baseSnapshot)
    expect(text).toContain('⚠️')
    expect(text).toContain('sonnetPaceExceeded')
    expect(text).toContain('codexPaceExceeded')
  })

  it('メモリが含まれる場合は表示される', () => {
    const snapshot = {
      ...baseSnapshot,
      memory: { permanentMemory: '# MEMORY\n- TypeScriptが好き', dailyLog: '## 今日\n- テスト' },
    }
    const text = formatSnapshotForPrompt(snapshot)
    expect(text).toContain('永続メモリ')
    expect(text).toContain('TypeScriptが好き')
    expect(text).toContain('本日・昨日のログ')
  })

  it('メモリが 600 文字を超えると省略される', () => {
    const longMem = 'x'.repeat(700)
    const snapshot = {
      ...baseSnapshot,
      memory: { permanentMemory: longMem, dailyLog: '' },
    }
    const text = formatSnapshotForPrompt(snapshot)
    expect(text).toContain('…(省略)')
  })

  it('ロック解除状態では空きマークが表示される', () => {
    const snapshot = {
      ...baseSnapshot,
      queue: { ...baseSnapshot.queue, isLocked: false, processingItem: null },
    }
    const text = formatSnapshotForPrompt(snapshot)
    expect(text).toContain('🔓 空き')
  })
})
