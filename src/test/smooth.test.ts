import { describe, expect, it } from 'vitest'
import { bilateralSmoothRGBA, colorDetailStrength, reliefLowPassField, smoothScalarField } from '../lib/smooth'

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

/** Robust span of a field: high and low quantiles, so single pixels cannot set it. */
function spanP(a: Float32Array, high: number, low: number): number {
  const s = Array.from(a).sort((x, y) => x - y)
  const p = (q: number) => s[Math.floor(q * (s.length - 1))]
  return p(high) - p(low)
}

describe('colorDetailStrength', () => {
  it('passes a gentle slider value through unchanged', () => {
    expect(colorDetailStrength(0.2)).toBeCloseTo(0.2, 6)
  })

  it('caps a strong slider value at one kernel cell', () => {
    // The color pass must never grow the kernel the way the relief pass does:
    // its luminance carries the band boundaries, and those are the picture.
    // The cap has to keep the kernel at one cell (radiusOf rounds 3·k).
    expect(colorDetailStrength(1)).toBeGreaterThan(0)
    expect(colorDetailStrength(1)).toBeLessThan(0.5)
    expect(Math.round(colorDetailStrength(1) * 3)).toBe(1)
    expect(colorDetailStrength(0.8)).toBe(colorDetailStrength(1))
  })

  it('keeps 0 at 0 and survives a non-finite strength', () => {
    expect(colorDetailStrength(0)).toBe(0)
    expect(colorDetailStrength(Number.NaN)).toBe(0)
    expect(colorDetailStrength(-1)).toBe(0)
  })
})

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

  it('a photo-detail edge is NOT a cliff anymore: no local steps survive', () => {
    // Detailed interior (dark figure on a bright background). As a printed
    // cliff the figure's border jumps 0.35 in one pixel; after the low-pass the
    // surface must step nowhere near that — that is the "himalayas" fix.
    const f = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = 0.2 + (x / (W - 1)) * 0.6
    for (let y = 5; y < 11; y++) for (let x = 6; x < 10; x++) f[y * W + x] = 0.05
    const maxStep = (a: Float32Array) => {
      let worst = 0
      for (let y = 0; y < H; y++) {
        for (let x = 1; x < W; x++) worst = Math.max(worst, Math.abs(a[y * W + x] - a[y * W + x - 1]))
      }
      return worst
    }
    const out = reliefLowPassField(f, W, H, 0.7)
    expect(maxStep(out)).toBeLessThan(maxStep(f) * 0.5)
    // The figure is no longer a hole in the surface: it sits on the slope.
    expect(out[8 * W + 8]).toBeLessThan(0.2)
  })

  it('keeps the depth of the large forms instead of printing a plate', () => {
    // The blur alone squeezes the field toward its middle and the print reads
    // as a flat tile; the pass must hand the picture's own tonal range back.
    const f = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = 0.15 + (y / (H - 1)) * 0.7
    const out = reliefLowPassField(f, W, H, 0.8)
    expect(spanP(out, 0.9, 0.1)).toBeGreaterThan(spanP(f, 0.9, 0.1) * 0.9)
  })

  it('a photo with a dark subject keeps its tonal span, not just its shapes', () => {
    // The figure never reaches the floor after the pass, so it must not decide
    // the relief range either: the depth comes from the picture's own tonal
    // span (the ramp), which the printed surface still has to cover.
    const f = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = 0.2 + (x / (W - 1)) * 0.6
    for (let y = 5; y < 11; y++) for (let x = 6; x < 10; x++) f[y * W + x] = 0.05
    const out = reliefLowPassField(f, W, H, 0.7)
    const values = Array.from(out).sort((a, b) => a - b)
    const p = (q: number) => values[Math.floor(q * (values.length - 1))]
    expect(p(0.95) - p(0.05)).toBeGreaterThan(0.45)
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
