import { describe, expect, it } from 'vitest'
import { colorShares, formatShare } from '../lib/colorShare'

describe('colorShares', () => {
  it('counts each index across the map', () => {
    const map = new Uint8Array([0, 0, 1, 2, 2, 2])
    const res = colorShares(map, 3)
    expect(res.map((r) => r.percent)).toEqual([33.3, 16.7, 50])
  })

  it('handles an unused color (0%)', () => {
    const map = new Uint8Array([0, 0, 0])
    const res = colorShares(map, 3)
    expect(res[1].percent).toBe(0)
    expect(res[2].percent).toBe(0)
    expect(res[0].percent).toBe(100)
  })

  it('sums to ~100%', () => {
    const map = new Uint8Array(1000).map((_, i) => i % 7)
    const res = colorShares(map, 7)
    const sum = res.reduce((s, r) => s + r.share, 0)
    expect(sum).toBeCloseTo(1)
  })

  it('empty map yields zeros, not NaN', () => {
    const res = colorShares(new Uint8Array(0), 2)
    expect(res.map((r) => r.percent)).toEqual([0, 0])
  })
})

describe('formatShare', () => {
  it('formats one decimal', () => {
    expect(formatShare(12.34)).toBe('12.3%')
    expect(formatShare(0)).toBe('0.0%')
  })
})
