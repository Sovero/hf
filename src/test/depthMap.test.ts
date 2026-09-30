import { describe, expect, it } from 'vitest'
import { depthToRelief, normalizeDepth, resampleDepth, type DepthMap } from '../lib/depth/depthMap'

function ramp(n: number, from: number, to: number): Float32Array {
  return Float32Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1))
}

describe('normalizeDepth', () => {
  it('stretches a plain ramp to 0..1', () => {
    const { data, flat } = normalizeDepth(ramp(1000, 1.3, 2.5))
    expect(flat).toBe(false)
    expect(Math.min(...data)).toBeCloseTo(0, 5)
    expect(Math.max(...data)).toBeCloseTo(1, 5)
    // Order is preserved.
    for (let i = 1; i < data.length; i++) expect(data[i]!).toBeGreaterThanOrEqual(data[i - 1]!)
  })

  it('does not let a few extreme pixels squeeze the subject into a sliver', () => {
    const raw = ramp(1000, 1, 2)
    raw[0] = -500 // a stray far outlier
    raw[999] = 900 // a stray near outlier
    const { data } = normalizeDepth(raw)
    // Min/max scaling would put the middle of the ramp at ~0.35; percentiles keep it central.
    expect(data[500]!).toBeGreaterThan(0.4)
    expect(data[500]!).toBeLessThan(0.6)
    // The outliers are clamped, not scaled beyond the range.
    expect(data[0]!).toBe(0)
    expect(data[999]!).toBe(1)
  })

  it('reports a solid input as flat instead of inventing a range', () => {
    const { data, flat } = normalizeDepth(new Float32Array(64).fill(3.7))
    expect(flat).toBe(true)
    expect(data.every((v) => v === 0)).toBe(true)
  })

  it('reports non-finite input as flat and never emits NaN', () => {
    expect(normalizeDepth(new Float32Array(8).fill(NaN)).flat).toBe(true)
    const mixed = ramp(100, 0, 1)
    mixed[10] = NaN
    mixed[11] = Infinity
    const { data } = normalizeDepth(mixed)
    expect(data.every((v) => Number.isFinite(v))).toBe(true)
  })

  it('falls back to the full range when one value dominates the percentiles', () => {
    const raw = new Float32Array(1000).fill(5)
    raw[3] = 9
    raw[4] = 1
    const { data, flat } = normalizeDepth(raw)
    expect(flat).toBe(false)
    expect(data[3]!).toBe(1)
    expect(data[4]!).toBe(0)
  })
})

describe('resampleDepth', () => {
  const map: DepthMap = { width: 2, height: 2, data: Float32Array.from([0, 1, 1, 0]) }

  it('returns the same map when the size already matches', () => {
    expect(resampleDepth(map, 2, 2)).toBe(map)
  })

  it('interpolates smoothly when enlarging and keeps values inside the source range', () => {
    const big = resampleDepth(map, 8, 8)
    expect(big.width).toBe(8)
    expect(big.height).toBe(8)
    expect(big.data.length).toBe(64)
    for (const v of big.data) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    // Corners keep the source corner values (pixel-centre alignment clamps the edge).
    expect(big.data[0]).toBeCloseTo(0, 5)
    expect(big.data[7]).toBeCloseTo(1, 5)
  })

  it('keeps the orientation of a horizontal gradient at another aspect ratio', () => {
    const grad: DepthMap = { width: 4, height: 1, data: Float32Array.from([0, 0.25, 0.75, 1]) }
    const out = resampleDepth(grad, 10, 3)
    for (let y = 0; y < 3; y++) {
      for (let x = 1; x < 10; x++) expect(out.data[y * 10 + x]!).toBeGreaterThanOrEqual(out.data[y * 10 + x - 1]!)
    }
  })
})

describe('depthToRelief', () => {
  const map: DepthMap = { width: 2, height: 1, data: Float32Array.from([0.2, 0.9]) }

  it('returns a fresh array so the cached map survives transfers', () => {
    const a = depthToRelief(map, 2, 1)
    expect(a).not.toBe(map.data)
    a[0] = 99
    expect(map.data[0]).toBeCloseTo(0.2, 6)
  })

  it('inverts so the farther surface stands tallest', () => {
    const inv = depthToRelief(map, 2, 1, true)
    expect(inv[0]).toBeCloseTo(0.8, 6)
    expect(inv[1]).toBeCloseTo(0.1, 6)
  })
})
