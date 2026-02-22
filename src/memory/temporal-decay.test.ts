import { describe, it, expect } from 'vitest'
import { applyTemporalDecay, getAgeInDays, isEvergreenPath } from './temporal-decay.js'

describe('temporal-decay', () => {
  describe('applyTemporalDecay', () => {
    it('should return full score for age 0', () => {
      expect(applyTemporalDecay(1.0, 0)).toBeCloseTo(1.0)
    })

    it('should return half score at half-life (30 days)', () => {
      expect(applyTemporalDecay(1.0, 30, 30)).toBeCloseTo(0.5, 1)
    })

    it('should return quarter score at 2x half-life', () => {
      expect(applyTemporalDecay(1.0, 60, 30)).toBeCloseTo(0.25, 1)
    })

    it('should retain ~84% at 7 days', () => {
      const score = applyTemporalDecay(1.0, 7, 30)
      expect(score).toBeGreaterThan(0.8)
      expect(score).toBeLessThan(0.9)
    })

    it('should retain ~12.5% at 90 days', () => {
      const score = applyTemporalDecay(1.0, 90, 30)
      expect(score).toBeCloseTo(0.125, 1)
    })

    it('should handle negative age by clamping to 0', () => {
      expect(applyTemporalDecay(1.0, -5, 30)).toBeCloseTo(1.0)
    })

    it('should handle zero half-life by returning original score', () => {
      expect(applyTemporalDecay(0.8, 10, 0)).toBe(0.8)
    })

    it('should scale with input score', () => {
      const score = applyTemporalDecay(0.5, 30, 30)
      expect(score).toBeCloseTo(0.25, 1)
    })
  })

  describe('isEvergreenPath', () => {
    it('should identify MEMORY.md as evergreen', () => {
      expect(isEvergreenPath('/data/memory/guild1/MEMORY.md')).toBe(true)
    })

    it('should identify non-dated .md files as evergreen', () => {
      expect(isEvergreenPath('/data/memory/guild1/project-notes.md')).toBe(true)
    })

    it('should NOT identify dated files as evergreen', () => {
      expect(isEvergreenPath('/data/memory/guild1/2026-02-23.md')).toBe(false)
    })
  })

  describe('getAgeInDays', () => {
    it('should return -1 for MEMORY.md (evergreen)', () => {
      expect(getAgeInDays('/data/memory/guild1/MEMORY.md')).toBe(-1)
    })

    it('should return -1 for non-dated .md files (evergreen)', () => {
      expect(getAgeInDays('/data/memory/guild1/notes.md')).toBe(-1)
    })

    it('should extract date from filename and calculate age', () => {
      const today = new Date()
      const jst = new Date(today.getTime() + 9 * 60 * 60 * 1000)
      const dateStr = jst.toISOString().slice(0, 10)

      // 今日のファイル → ageは0に近い
      const age = getAgeInDays(`/data/memory/guild1/${dateStr}.md`)
      expect(age).toBeGreaterThanOrEqual(0)
      expect(age).toBeLessThan(1)
    })
  })
})
