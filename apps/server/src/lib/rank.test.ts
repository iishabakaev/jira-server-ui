import { describe, expect, it } from 'bun:test'
import { rankAfter, rankBefore, rankBetween, rankSequence } from './rank'

// Базовая инвариант: вывод любой rank-функции всегда лексикографически
// строго между указанными границами.

describe('rankBetween', () => {
  it('returns midpoint when both ends are null', () => {
    const r = rankBetween(null, null)
    expect(r.length).toBeGreaterThan(0)
  })

  it('inserts strictly between two ranks', () => {
    const a = 'a'
    const b = 'b'
    const r = rankBetween(a, b)
    expect(r > a).toBe(true)
    expect(r < b).toBe(true)
  })

  it('extends string when ranks are adjacent', () => {
    const a = 'a'
    const b = 'ab'
    const r = rankBetween(a, b)
    expect(r > a).toBe(true)
    expect(r < b).toBe(true)
  })

  it('handles deep nesting without infinite recursion', () => {
    let prev = 'a'
    const next = 'b'
    for (let i = 0; i < 50; i += 1) {
      const r = rankBetween(prev, next)
      expect(r > prev).toBe(true)
      expect(r < next).toBe(true)
      prev = r
    }
  })

  it('handles prev>=next gracefully by appending after prev', () => {
    const r = rankBetween('b', 'a')
    expect(r > 'b').toBe(true)
  })
})

describe('rankBefore / rankAfter', () => {
  it('rankBefore returns smaller rank', () => {
    const r = rankBefore('m')
    expect(r < 'm').toBe(true)
  })

  it('rankAfter returns larger rank', () => {
    const r = rankAfter('m')
    expect(r > 'm').toBe(true)
  })

  it('rankBefore on minimal-char rank stays valid', () => {
    const r = rankBefore('0a')
    expect(r < '0a').toBe(true)
    expect(r.length).toBeGreaterThan(0)
  })

  it('rankAfter on max-char rank extends', () => {
    const r = rankAfter('z')
    expect(r > 'z').toBe(true)
  })
})

describe('rankSequence', () => {
  it('produces a strictly increasing sequence', () => {
    const ranks = rankSequence('a', 'b', 5)
    expect(ranks).toHaveLength(5)
    for (let i = 0; i < ranks.length; i += 1) {
      expect(ranks[i]! > 'a').toBe(true)
      expect(ranks[i]! < 'b').toBe(true)
      if (i > 0) expect(ranks[i]! > ranks[i - 1]!).toBe(true)
    }
  })

  it('empty sequence for n<=0', () => {
    expect(rankSequence(null, null, 0)).toEqual([])
    expect(rankSequence(null, null, -1)).toEqual([])
  })

  it('null-bounds works for the head of a column', () => {
    const ranks = rankSequence(null, 'm', 3)
    expect(ranks).toHaveLength(3)
    expect(ranks[2]! < 'm').toBe(true)
  })
})
