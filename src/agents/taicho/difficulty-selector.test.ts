import { describe, it, expect } from 'vitest'
import { extractDifficulty, getRecommendedStrategy, selectStrategyByDifficulty } from './difficulty-selector.js'

describe('difficulty-selector', () => {
  describe('extractDifficulty()', () => {
    it('difficulty:S ラベルから S を抽出', () => {
      expect(extractDifficulty(['difficulty:S', 'enhancement'])).toBe('S')
    })

    it('difficulty:M ラベルから M を抽出', () => {
      expect(extractDifficulty(['difficulty:M', 'bug'])).toBe('M')
    })

    it('difficulty:L ラベルから L を抽出', () => {
      expect(extractDifficulty(['difficulty:L'])).toBe('L')
    })

    it('difficulty:XL ラベルから XL を抽出', () => {
      expect(extractDifficulty(['difficulty:XL', 'feature'])).toBe('XL')
    })

    it('ラベルがない場合はデフォルト M を返す', () => {
      expect(extractDifficulty([])).toBe('M')
      expect(extractDifficulty(['enhancement', 'bug'])).toBe('M')
    })

    it('複数の difficulty: ラベルがある場合は最初のものを返す', () => {
      expect(extractDifficulty(['difficulty:L', 'difficulty:M'])).toBe('L')
    })

    it('小文字の difficulty:s も対応', () => {
      expect(extractDifficulty(['difficulty:s'])).toBe('S')
    })
  })

  describe('getRecommendedStrategy()', () => {
    it('S → claude-cli を推奨', () => {
      expect(getRecommendedStrategy('S')).toBe('claude-cli')
    })

    it('M → claude-cli を推奨（初期実装）', () => {
      expect(getRecommendedStrategy('M')).toBe('claude-cli')
    })

    it('L → orchestrator-workers を推奨', () => {
      expect(getRecommendedStrategy('L')).toBe('orchestrator-workers')
    })

    it('XL → shogun を推奨', () => {
      expect(getRecommendedStrategy('XL')).toBe('shogun')
    })
  })

  describe('selectStrategyByDifficulty()', () => {
    it('Issue ラベルから難易度を抽出し、Strategy を返す', () => {
      const issue = { labels: ['difficulty:L', 'enhancement'] } as any
      expect(selectStrategyByDifficulty(issue)).toBe('orchestrator-workers')
    })

    it('ラベルなしの場合はデフォルト M → claude-cli', () => {
      const issue = { labels: [] } as any
      expect(selectStrategyByDifficulty(issue)).toBe('claude-cli')
    })
  })
})
