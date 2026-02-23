import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let tmpDir: string

vi.mock('../config.js', () => {
  const dir = mkdtempSync(join(tmpdir(), 'strategy-eval-test-'))
  return {
    config: {
      queue: { dataDir: dir },
    },
  }
})

import { recordStrategyEval, getAllStrategyEvals, getStrategyReport, getDifficultyStrategyReport } from './strategy-eval.js'

describe('strategy-eval', () => {
  beforeEach(async () => {
    const { config } = await import('../config.js')
    tmpDir = config.queue.dataDir
  })

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe('recordStrategyEval', () => {
    it('評価レコードを記録', () => {
      recordStrategyEval({
        issueNumber: 100,
        repository: 'test/repo',
        difficulty: 'M',
        strategyName: 'claude-cli',
        success: true,
        durationMs: 5000,
        retryCount: 0,
        commitCount: 1,
        linesAdded: 50,
        linesRemoved: 10,
        filesChanged: 2,
      })

      const records = getAllStrategyEvals()
      expect(records).toHaveLength(1)
      expect(records[0].issueNumber).toBe(100)
      expect(records[0].strategyName).toBe('claude-cli')
      expect(records[0].success).toBe(true)
    })
  })

  describe('getStrategyReport', () => {
    it('Strategy 別の集計レポートを生成', () => {
      recordStrategyEval({
        issueNumber: 100,
        repository: 'test/repo',
        difficulty: 'M',
        strategyName: 'claude-cli',
        success: true,
        durationMs: 5000,
        retryCount: 0,
        commitCount: 1,
        linesAdded: 50,
        linesRemoved: 10,
        filesChanged: 2,
      })

      recordStrategyEval({
        issueNumber: 101,
        repository: 'test/repo',
        difficulty: 'L',
        strategyName: 'claude-cli',
        success: false,
        durationMs: 30000,
        retryCount: 2,
        commitCount: 0,
        linesAdded: 0,
        linesRemoved: 0,
        filesChanged: 0,
      })

      recordStrategyEval({
        issueNumber: 102,
        repository: 'test/repo',
        difficulty: 'L',
        strategyName: 'shogun',
        success: true,
        durationMs: 45000,
        retryCount: 0,
        commitCount: 3,
        linesAdded: 200,
        linesRemoved: 50,
        filesChanged: 5,
      })

      const report = getStrategyReport()
      expect(report).toHaveLength(2)

      const cliReport = report.find((r) => r.strategyName === 'claude-cli')!
      expect(cliReport.count).toBe(2)
      expect(cliReport.successCount).toBe(1)
      expect(cliReport.successRate).toBe(50)
      expect(cliReport.avgDurationMs).toBe(17500)

      const shogunReport = report.find((r) => r.strategyName === 'shogun')!
      expect(shogunReport.count).toBe(1)
      expect(shogunReport.successCount).toBe(1)
      expect(shogunReport.successRate).toBe(100)
    })
  })

  describe('getDifficultyStrategyReport', () => {
    it('難易度別 Strategy の集計レポートを生成', () => {
      recordStrategyEval({
        issueNumber: 100,
        repository: 'test/repo',
        difficulty: 'S',
        strategyName: 'claude-cli',
        success: true,
        durationMs: 2000,
        retryCount: 0,
        commitCount: 1,
        linesAdded: 10,
        linesRemoved: 5,
        filesChanged: 1,
      })

      recordStrategyEval({
        issueNumber: 101,
        repository: 'test/repo',
        difficulty: 'M',
        strategyName: 'claude-cli',
        success: true,
        durationMs: 8000,
        retryCount: 0,
        commitCount: 2,
        linesAdded: 50,
        linesRemoved: 10,
        filesChanged: 2,
      })

      const report = getDifficultyStrategyReport()
      expect(report).toHaveLength(2)

      expect(report[0].difficulty).toBe('S')
      expect(report[0].strategyName).toBe('claude-cli')
      expect(report[0].count).toBe(1)
      expect(report[0].successRate).toBe(100)

      expect(report[1].difficulty).toBe('M')
      expect(report[1].strategyName).toBe('claude-cli')
      expect(report[1].count).toBe(1)
      expect(report[1].successRate).toBe(100)
    })

    it('難易度順にソートされる', () => {
      recordStrategyEval({
        issueNumber: 100,
        repository: 'test/repo',
        difficulty: 'XL',
        strategyName: 'enterprise',
        success: true,
        durationMs: 120000,
        retryCount: 0,
        commitCount: 10,
        linesAdded: 500,
        linesRemoved: 100,
        filesChanged: 20,
      })

      recordStrategyEval({
        issueNumber: 101,
        repository: 'test/repo',
        difficulty: 'S',
        strategyName: 'claude-cli',
        success: true,
        durationMs: 2000,
        retryCount: 0,
        commitCount: 1,
        linesAdded: 10,
        linesRemoved: 5,
        filesChanged: 1,
      })

      const report = getDifficultyStrategyReport()
      expect(report[0].difficulty).toBe('S')
      expect(report[1].difficulty).toBe('XL')
    })
  })
})
