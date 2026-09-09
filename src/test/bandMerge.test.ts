import { describe, expect, it } from 'vitest'
import { applyMerge, deltaE, mergeMap, rgbToLab } from '../lib/bandMerge'
import type { RGB } from '../lib/types'

const C = (r: number, g: number, b: number): RGB => ({ r, g, b })

describe('rgbToLab / deltaE', () => {
  it('maps white to L≈100 and black to L=0', () => {
    expect(rgbToLab(C(255, 255, 255))[0]).toBeCloseTo(100, 0)
    expect(rgbToLab(C(0, 0, 0))[0]).toBeCloseTo(0, 0)
  })

  it('ΔE of identical colors is 0', () => {
    expect(deltaE(C(120, 80, 40), C(120, 80, 40))).toBe(0)
  })

  it('ΔE is symmetric', () => {
    const a = C(200, 30, 30)
    const b = C(190, 40, 35)
    expect(deltaE(a, b)).toBeCloseTo(deltaE(b, a), 6)
  })

  it('near-duplicate grays score well under a jnd, distinct colors well over', () => {
    const near = deltaE(C(120, 120, 120), C(126, 126, 126))
    const far = deltaE(C(20, 20, 20), C(240, 240, 240))
    expect(near).toBeLessThan(4)
    expect(far).toBeGreaterThan(60)
  })

  it('equal-luma hues stay perceptually far (ΔE sees hue, luma does not)', () => {
    // Same Rec.709 luma, clearly different hue.
    const dark = C(60, 60, 60)
    const red = C(255, 0, 0)
    expect(deltaE(dark, red)).toBeGreaterThan(30)
  })
})

describe('mergeMap', () => {
  it('keeps a 2-color palette intact regardless of threshold', () => {
    const p = [C(10, 10, 10), C(240, 240, 240)]
    expect(mergeMap(p, 50)).toEqual([0, 1])
  })

  it('merges adjacent near-duplicates into the earlier (kept) slot', () => {
    const p = [C(10, 10, 10), C(120, 120, 120), C(124, 124, 124), C(240, 240, 240)]
    const m = mergeMap(p, 10)
    expect(m).toEqual([0, 1, 1, 3])
  })

  it('chains a run of similar colors onto one survivor', () => {
    const p = [C(100, 100, 100), C(102, 102, 102), C(104, 104, 104)]
    const m = mergeMap(p, 10)
    expect(m).toEqual([0, 0, 0])
  })

  it('compares against the kept color, so distant bookends both survive', () => {
    const p = [C(10, 10, 10), C(120, 120, 120), C(230, 230, 230)]
    const m = mergeMap(p, 8)
    expect(m).toEqual([0, 1, 2])
  })

  it('threshold 0 or negative is a no-op', () => {
    const p = [C(10, 10, 10), C(11, 11, 11)]
    expect(mergeMap(p, 0)).toEqual([0, 1])
    expect(mergeMap(p, -5)).toEqual([0, 1])
  })

  it('is deterministic', () => {
    const p = [C(10, 10, 10), C(122, 122, 122), C(125, 125, 125)]
    expect(mergeMap(p, 10)).toEqual(mergeMap(p, 10))
  })
})

describe('applyMerge', () => {
  it('remaps labels and reports kept indexes in dark → light order', () => {
    const map = [0, 1, 1, 3]
    const labels = new Uint8Array([0, 1, 2, 2, 3, 1])
    const { indexMap, kept } = applyMerge(labels, map)
    expect(kept).toEqual([0, 1, 3])
    // Old 2 merges into 1; kept indexes renumber 0,1,2.
    expect(Array.from(indexMap)).toEqual([0, 1, 1, 1, 2, 1])
  })

  it('identity map leaves everything untouched', () => {
    const labels = new Uint8Array([0, 1, 2, 3])
    const { indexMap, kept } = applyMerge(labels, [0, 1, 2, 3])
    expect(kept).toEqual([0, 1, 2, 3])
    expect(Array.from(indexMap)).toEqual([0, 1, 2, 3])
  })
})
