import { describe, expect, it } from 'vitest'
import { bilateralSmoothRGBA, reliefLowPassField, smoothScalarField } from '../lib/smooth'

const W = 16
const H = 16

function solidRGB(r: number, g: number, b: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) a.set([r, g, b, 255], i * 4)
  return a
}

function verticalEdge(): Uint8ClampedArray {
  const a = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) a.set([x < W / 2 ? 20 : 230, x < W / 2 ? 20 : 230, x < W / 2 ? 20 : 230, 255], (y * W + x) * 4)
  return a
}

describe('bilateralSmoothRGBA', () => {
  it('strength 0 returns the same buffer untouched', () => {
    const src = verticalEdge()
    expect(bilateralSmoothRGBA(src, W, H, 0)).toBe(src)
  })

  it('a flat field does not change', () => {
    const src = solidRGB(90, 120, 200)
    const out = bilateralSmoothRGBA(src, W, H, 0.5)
    expect(Array.from(out)).toEqual(Array.from(src))
  })

  it('a sharp edge keeps its step: transition no wider than +2 cells', () => {
    const src = verticalEdge()
    const out = bilateralSmoothRGBA(src, W, H, 0.8)
    const lumAt = (arr: Uint8ClampedArray, x: number, y = 8) => {
      const i = (y * W + x) * 4
      return 0.299 * arr[i] + 0.587 * arr[i + 1] + 0.114 * arr[i + 2]
    }
    // Transition width: columns between the 25% and 75% points of the step.
    const width = (arr: Uint8ClampedArray) => {
      let lo = 0
      let hi = W - 1
      while (lo < W && lumAt(arr, lo) > 80) lo++
      while (hi >= 0 && lumAt(arr, hi) < 170) hi--
      return hi - lo
    }
    expect(width(out)).toBeLessThanOrEqual(width(src) + 2)
    // The step really exists (did not collapse into the middle).
    expect(lumAt(out, 1)).toBeLessThan(60)
    expect(lumAt(out, W - 2)).toBeGreaterThan(190)
  })

  it('ramp noise calms down while the mean level holds', () => {
    const src = new Uint8ClampedArray(W * H * 4)
    let seed = 42
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 60
    for (let i = 0; i < W * H; i++) {
      const v = Math.round((i / (W * H)) * 200 + 28 + rnd())
      src.set([v, v, v, 255], i * 4)
    }
    const out = bilateralSmoothRGBA(src, W, H, 0.6)
    const dev = (a: Uint8ClampedArray) => {
      let s = 0
      for (let i = 0; i < W * H; i++) {
        const v = a[i * 4]
        const ideal = 28 + (i / (W * H)) * 200
        s += Math.abs(v - ideal)
      }
      return s / (W * H)
    }
    expect(dev(out)).toBeLessThan(dev(src) * 0.6)
  })

  it('alpha is untouched', () => {
    const src = solidRGB(10, 10, 10)
    for (let i = 0; i < W * H; i++) src[i * 4 + 3] = 7
    const out = bilateralSmoothRGBA(src, W, H, 0.9)
    for (let i = 0; i < W * H; i++) expect(out[i * 4 + 3]).toBe(7)
  })
})

describe('smoothScalarField', () => {
  it('strength 0 returns the same field', () => {
    const f = new Float32Array(W * H).fill(0.4)
    expect(smoothScalarField(f, W, H, 0)).toBe(f)
  })

  it('a plateau is not blurred', () => {
    const f = new Float32Array(W * H).fill(0.5)
    const out = smoothScalarField(f, W, H, 0.7)
    expect(Array.from(out)).toEqual(Array.from(f))
  })

  it('a noise-scale spike is flattened while a feature-scale edge survives', () => {
    // Noise-scale spike (d ≈ σ): neighbours pull it back down.
    const f = new Float32Array(W * H).fill(0.4)
    f[8 * W + 8] = 0.55
    const out = smoothScalarField(f, W, H, 0.7)
    expect(out[8 * W + 8]).toBeLessThan(0.5)
    expect(out[3 * W + 3]).toBeCloseTo(0.4, 5)

    // Feature-scale spike (d ≫ σ): a real one-cell edge (a bright dot in the
    // photo) must survive — that is the edge-preserving contract.
    const g = new Float32Array(W * H).fill(0.4)
    g[8 * W + 8] = 1.0
    const outG = smoothScalarField(g, W, H, 0.7)
    expect(outG[8 * W + 8]).toBeGreaterThan(0.9)
  })

  it('a sharp terrace keeps its step', () => {
    const f = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = x < W / 2 ? 0.1 : 0.9
    const out = smoothScalarField(f, W, H, 0.8)
    expect(out[8 * W + 1]).toBeLessThan(0.25)
    expect(out[8 * W + W - 2]).toBeGreaterThan(0.75)
  })
})

describe('reliefLowPassField', () => {
  it('strength 0 returns the same field', () => {
    const f = new Float32Array(W * H).fill(0.4)
    expect(reliefLowPassField(f, W, H, 0)).toBe(f)
  })

  it('a photo-detail edge is NOT a cliff anymore: interior span shrinks hard', () => {
    // Detailed interior (dark figure on a bright background) + a real large
    // gradient. The low-pass must flatten the small figure but keep the
    // large ramp: the ENVELOPE (p95..p5 span) shrinks.
    const f = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = 0.2 + (x / (W - 1)) * 0.6
    for (let y = 5; y < 11; y++) for (let x = 6; x < 10; x++) f[y * W + x] = 0.05
    const span = (a: Float32Array) => {
      const s = Array.from(a).sort((x, y) => x - y)
      const p = (q: number) => s[Math.floor(q * (s.length - 1))]
      return p(0.95) - p(0.05)
    }
    const out = reliefLowPassField(f, W, H, 0.7)
    expect(span(out)).toBeLessThan(span(f) * 0.9)
    // The figure's canyon is filled: the darkest blurred point rises well
    // above the original 0.05 detail floor (the ramp's own left edge is 0.2).
    let min = Infinity
    for (let i = 0; i < out.length; i++) if (out[i] < min) min = out[i]
    expect(min).toBeGreaterThan(0.05 * 2)
  })

  it('stays inside the 0..1 relief domain and keeps the vertical ramp ordering', () => {
    const f = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = (y / (H - 1)) * 0.8 + 0.1
    const out = reliefLowPassField(f, W, H, 0.9)
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(0)
      expect(out[i]).toBeLessThanOrEqual(1)
    }
    // The large-form ordering survives: the vertical ramp keeps its direction
    // after the border-clamped blur (rows stay monotone top → bottom).
    const midCol = 8
    for (let y = 1; y < H; y++) {
      expect(out[y * W + midCol]).toBeGreaterThanOrEqual(out[(y - 1) * W + midCol] - 1e-6)
    }
  })

  it('flat field stays byte-identical', () => {
    const f = new Float32Array(W * H).fill(0.4)
    const out = reliefLowPassField(f, W, H, 0.7)
    expect(Array.from(out)).toEqual(Array.from(f))
  })
})
