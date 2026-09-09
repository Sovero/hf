import { describe, expect, it } from 'vitest'
import { dropSparseColors } from '../lib/dropSparse'

const P = (r: number, g: number, b: number) => ({ r, g, b })

/** Shared fixture for the reassignment test: black (70%), dark gray (10%), white (20%). */
const map = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1, 2, 2])
const PAL = [P(0, 0, 0), P(60, 60, 60), P(255, 255, 255)]

describe('dropSparseColors', () => {
  it('drops sub-threshold colors and remaps indexes densely', () => {
    // 80% color0, 20% color1, 0% color2.
    const map = new Uint8Array([0, 0, 0, 0, 1, 1])
    const res = dropSparseColors(map, [P(1, 1, 1), P(2, 2, 2), P(3, 3, 3)], 0.01)!
    expect(res.palette).toEqual([P(1, 1, 1), P(2, 2, 2)])
    expect(res.dropped).toBe(1)
    expect([...res.indexMap]).toEqual([0, 0, 0, 0, 1, 1])
  })

  it('shifts indexes after a dropped middle color', () => {
    // 2/12 color0 (~17%), 1/12 color1 (~8%), 9/12 color2 (75%).
    const map = new Uint8Array([0, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2])
    const res = dropSparseColors(map, [P(0, 0, 0), P(9, 9, 9), P(5, 5, 5)], 0.15)!
    expect(res.palette).toEqual([P(0, 0, 0), P(5, 5, 5)])
    // color0→0, color2→1; the dropped color1 pixel remaps to 0 (its slot is
    // removed, so it merges into the previous kept color by remap order).
    expect([...res.indexMap]).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1])
  })

  it('returns null when nothing is below the threshold', () => {
    const map = new Uint8Array([0, 1])
    expect(dropSparseColors(map, [P(1, 1, 1), P(2, 2, 2)], 0.01)).toBeNull()
  })

  it('returns null when nothing would survive an all-dropped palette', () => {
    // Both colors at 50% — with threshold 0.6 nothing survives.
    const map = new Uint8Array([0, 1])
    expect(dropSparseColors(map, [P(1, 1, 1), P(2, 2, 2)], 0.6)).toBeNull()
  })

  it('handles empty maps and palettes', () => {
    expect(dropSparseColors(new Uint8Array(0), [P(1, 1, 1)], 0.01)).toBeNull()
    expect(dropSparseColors(new Uint8Array([0]), [], 0.01)).toBeNull()
  })

  it('reports where each dropped color\'s pixels land (nearest survivor)', () => {
    // Black drops → merges into dark gray (nearest kept), white keeps.
    const res = dropSparseColors(map, PAL, 0.2)!
    expect(res.reassignments.get(1)).toBe(0) // dark gray → black
    expect(res.reassignments.has(2)).toBe(false) // white survives
  })

  it('targets the perceptually closest survivor, not just the next one', () => {
    // Palette: black, white, near-black. Near-black drops; its nearest
    // survivor is black (index 0), NOT white (the next kept by order).
    const pal = [P(0, 0, 0), P(255, 255, 255), P(10, 10, 10)]
    const m = new Uint8Array([0, 0, 1, 1, 1, 2]) // #2 at ~17% → drops at 0.2
    const res = dropSparseColors(m, pal, 0.2)!
    expect(res.reassignments.get(2)).toBe(0)
  })
})
