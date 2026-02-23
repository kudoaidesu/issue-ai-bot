import { describe, it, expect, vi, beforeEach } from 'vitest'

// SDK モジュールをモック
const mockQuery = vi.fn()

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// @anthropic-ai/claude-agent-sdk の動的インポートをモック
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}))

import { runClaudeSdk } from './claude-sdk.js'

describe('runClaudeSdk', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  it('should capture sessionId from init message', async () => {
    mockQuery.mockImplementation(function* () {
      yield {
        type: 'system',
        subtype: 'init',
        session_id: 'test-session-123',
      }
      yield {
        type: 'assistant',
        session_id: 'test-session-123',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello from SDK' }],
        },
      }
      yield {
        type: 'result',
        subtype: 'success',
        session_id: 'test-session-123',
        total_cost_usd: 0.001,
        result: 'Hello from SDK',
      }
    })

    const result = await runClaudeSdk({
      prompt: 'Hello',
      model: 'haiku',
    })

    expect(result.sessionId).toBe('test-session-123')
    expect(result.content).toBe('Hello from SDK')
  })

  it('should pass resume option to query', async () => {
    mockQuery.mockImplementation(function* () {
      yield {
        type: 'system',
        subtype: 'init',
        session_id: 'resumed-session',
      }
      yield {
        type: 'result',
        subtype: 'success',
        session_id: 'resumed-session',
        total_cost_usd: 0.002,
        result: 'Resumed response',
      }
    })

    const result = await runClaudeSdk({
      prompt: 'Continue',
      model: 'haiku',
      resume: 'previous-session-id',
    })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Continue',
        options: expect.objectContaining({
          resume: 'previous-session-id',
        }),
      }),
    )
    expect(result.sessionId).toBe('resumed-session')
  })

  it('should pass forkSession option', async () => {
    mockQuery.mockImplementation(function* () {
      yield {
        type: 'system',
        subtype: 'init',
        session_id: 'forked-session',
      }
      yield {
        type: 'result',
        subtype: 'success',
        session_id: 'forked-session',
        total_cost_usd: 0.001,
        result: 'Forked',
      }
    })

    await runClaudeSdk({
      prompt: 'Fork this',
      resume: 'original-session',
      forkSession: true,
    })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          resume: 'original-session',
          forkSession: true,
        }),
      }),
    )
  })

  it('should pass settingSources option', async () => {
    mockQuery.mockImplementation(function* () {
      yield {
        type: 'result',
        subtype: 'success',
        session_id: 'new-session',
        total_cost_usd: 0.001,
        result: 'Done',
      }
    })

    await runClaudeSdk({
      prompt: 'Test',
      settingSources: ['project'],
    })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          settingSources: ['project'],
        }),
      }),
    )
  })

  it('should extract text from assistant messages', async () => {
    mockQuery.mockImplementation(function* () {
      yield {
        type: 'assistant',
        session_id: 's1',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Part 1' },
            { type: 'text', text: ' Part 2' },
          ],
        },
      }
      yield {
        type: 'assistant',
        session_id: 's1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: ' Part 3' }],
        },
      }
      yield {
        type: 'result',
        subtype: 'success',
        session_id: 's1',
        total_cost_usd: 0.005,
      }
    })

    const result = await runClaudeSdk({ prompt: 'Multi-part' })
    expect(result.content).toBe('Part 1 Part 2 Part 3')
  })

  it('should use result text as fallback when no assistant messages', async () => {
    mockQuery.mockImplementation(function* () {
      yield {
        type: 'result',
        subtype: 'success',
        session_id: 's1',
        total_cost_usd: 0.001,
        result: 'Direct result text',
      }
    })

    const result = await runClaudeSdk({ prompt: 'Quick' })
    expect(result.content).toBe('Direct result text')
  })

  it('should handle legacy flat format messages', async () => {
    mockQuery.mockImplementation(function* () {
      yield {
        type: 'assistant',
        role: 'assistant',
        session_id: 's1',
        content: [{ type: 'text', text: 'Legacy format' }],
      }
      yield {
        type: 'result',
        subtype: 'success',
        session_id: 's1',
        total_cost_usd: 0.001,
      }
    })

    const result = await runClaudeSdk({ prompt: 'Legacy' })
    expect(result.content).toBe('Legacy format')
  })
})
