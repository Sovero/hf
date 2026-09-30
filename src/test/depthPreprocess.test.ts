import { describe, expect, it } from 'vitest'
import { DEPTH_LONG_SIDE, DEPTH_MULTIPLE, modelInputSize, rgbaToModelInput } from '../lib/depth/preprocess'

const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

function solid(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) px.set([r, g, b, 255], i * 4)
  return px
}

describe('modelInputSize', () => {
  it('fits the long side to 518 and keeps both sides multiples of 14', () => {
    for (const [w, h] of [[100, 100], [640, 480], [480, 640], [4000, 3000], [37, 1000], [1920, 1080]] as const) {
      const s = modelInputSize(w, h)
      expect(s.width % DEPTH_MULTIPLE).toBe(0)
      expect(s.height % DEPTH_MULTIPLE).toBe(0)
      expect(Math.max(s.width, s.height)).toBe(DEPTH_LONG_SIDE)
      expect(Math.min(s.width, s.height)).toBeGreaterThanOrEqual(DEPTH_MULTIPLE)
    }
  })

  it('keeps the aspect ratio close to the source', () => {
    const s = modelInputSize(640, 480)
    expect(s).toEqual({ width: 518, height: 392 })
    expect(Math.abs(s.width / s.height - 640 / 480)).toBeLessThan(0.05)
  })

  it('never returns a side smaller than one patch, even for a sliver', () => {
    expect(modelInputSize(2000, 3).height).toBe(DEPTH_MULTIPLE)
  })

  it('rejects an empty picture', () => {
    expect(() => modelInputSize(0, 10)).toThrow()
    expect(() => modelInputSize(10, 0)).toThrow()
  })
})

describe('rgbaToModelInput', () => {
  it('lays the tensor out as three channel planes with ImageNet normalization', () => {
    const out = rgbaToModelInput(solid(4, 4, 255, 0, 51), 4, 4, 4, 4)
    expect(out.length).toBe(3 * 16)
    const expected = [(1 - MEAN[0]!) / STD[0]!, (0 - MEAN[1]!) / STD[1]!, (0.2 - MEAN[2]!) / STD[2]!]
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < 16; i++) expect(out[c * 16 + i]).toBeCloseTo(expected[c]!, 5)
    }
  })

  it('averages by area when shrinking (no aliasing on a fine pattern)', () => {
    // A 1-px black/white checkerboard averages to mid-grey when shrunk 4×.
    const w = 16
    const px = new Uint8ClampedArray(w * w * 4)
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const v = (x + y) % 2 === 0 ? 255 : 0
        px.set([v, v, v, 255], (y * w + x) * 4)
      }
    }
    const out = rgbaToModelInput(px, w, w, 4, 4)
    const grey = (0.5 - MEAN[0]!) / STD[0]!
    for (let i = 0; i < 16; i++) expect(out[i]).toBeCloseTo(grey, 3)
  })

  it('interpolates when enlarging and stays inside the source range', () => {
    // Left column black, right column white, enlarged to 8 wide.
    const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
    const out = rgbaToModelInput(px, 2, 1, 8, 1)
    const lo = (0 - MEAN[0]!) / STD[0]!
    const hi = (1 - MEAN[0]!) / STD[0]!
    for (let x = 0; x < 8; x++) {
      expect(out[x]!).toBeGreaterThanOrEqual(lo - 1e-5)
      expect(out[x]!).toBeLessThanOrEqual(hi + 1e-5)
      if (x > 0) expect(out[x]!).toBeGreaterThanOrEqual(out[x - 1]! - 1e-6)
    }
    expect(out[0]).toBeCloseTo(lo, 4)
    expect(out[7]).toBeCloseTo(hi, 4)
  })

  it('handles a single-pixel picture', () => {
    const out = rgbaToModelInput(solid(1, 1, 10, 20, 30), 1, 1, 14, 14)
    expect(out.length).toBe(3 * 14 * 14)
    expect(out.every((v) => Number.isFinite(v))).toBe(true)
  })

  it('rejects a buffer shorter than width × height', () => {
    expect(() => rgbaToModelInput(new Uint8ClampedArray(8), 4, 4, 4, 4)).toThrow()
  })
})
