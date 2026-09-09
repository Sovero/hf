import { describe, expect, it } from 'vitest'
import { fitPrintSizeToAspect } from '../lib/printConsts'

describe('fitPrintSizeToAspect', () => {
  it('keeps the larger side of the current size and scales the other to the aspect', () => {
    // Current 150×200 keeps the 200 mm height; landscape 2:1 source → w = 400.
    expect(fitPrintSizeToAspect(800, 400, 150, 200)).toEqual({ widthMm: 400, heightMm: 200 })
    // Current 200×150 keeps the 200 mm width; portrait 1:2 source → h = 400.
    expect(fitPrintSizeToAspect(400, 800, 200, 150)).toEqual({ widthMm: 200, heightMm: 400 })
  })

  it('keeps square sources square regardless of current shape', () => {
    // Anchor is the larger current side in both cases.
    expect(fitPrintSizeToAspect(640, 640, 150, 200)).toEqual({ widthMm: 200, heightMm: 200 })
    expect(fitPrintSizeToAspect(640, 640, 200, 150)).toEqual({ widthMm: 200, heightMm: 200 })
  })

  it('clamps to max and preserves aspect by shrinking the other side', () => {
    // 10:1 panorama anchored at 500 on the long side.
    const r = fitPrintSizeToAspect(2000, 200, 150, 200)
    expect(r.widthMm).toBe(500)
    expect(r.heightMm).toBeCloseTo(50, 1)
  })

  it('clamps to min and preserves aspect by growing the other side', () => {
    // Anchor 200 mm on the long side; 1:20 source → w = 10 clamps to 20,
    // h grows back to 400 to keep the shape.
    const r = fitPrintSizeToAspect(100, 2000, 150, 200)
    expect(r.widthMm).toBe(20)
    expect(r.heightMm).toBeCloseTo(400, 1)
  })

  it('rounds to 0.1 mm', () => {
    // Current 200×150 anchors w = 200; 1:3 source → h = 600 clamps to 500,
    // w pulls back to 500/3 = 166.7.
    expect(fitPrintSizeToAspect(300, 900, 200, 150)).toEqual({ widthMm: 166.7, heightMm: 500 })
  })

  it('falls back to the current size on degenerate input', () => {
    expect(fitPrintSizeToAspect(0, 100, 150, 200)).toEqual({ widthMm: 150, heightMm: 200 })
    expect(fitPrintSizeToAspect(100, 0, 150, 200)).toEqual({ widthMm: 150, heightMm: 200 })
  })
})
