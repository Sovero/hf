import { describe, expect, it } from 'vitest'
import { mapToLuminanceBands } from '../lib/quantize'
import { finishPipeline } from '../lib/pipeline'

/**
 * Палитра режима «По яркости» берётся из настоящих цветов картинки, а не из
 * среднего по равным по числу пикселей срезам яркости.
 *
 * Типичный случай — логотип на большом тёмном фоне: при равном делении фон
 * забирал несколько полос подряд (почти одинаковые чёрные), а красный и белый
 * попадали в одну полосу и усреднялись в розовый.
 */

const W = 40
const H = 40

/** 70 % почти чёрного фона, 15 % красного, 15 % белого — крупными блоками. */
function logoOnDark(): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4
      let c: [number, number, number] = [12, 12, 12]
      if (y >= 28 && x < 20) c = [190, 25, 25]
      else if (y >= 28) c = [240, 240, 240]
      rgba[p] = c[0]
      rgba[p + 1] = c[1]
      rgba[p + 2] = c[2]
      rgba[p + 3] = 255
    }
  }
  return rgba
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

describe('brightness palette follows the picture colors', () => {
  for (const darkIsTall of [false, true]) {
    it(`keeps black, red and white as separate filaments (darkIsTall=${darkIsTall})`, () => {
      const q = mapToLuminanceBands(logoOnDark(), 3, W, H, darkIsTall, 0)
      const near = (c: { r: number; g: number; b: number }, t: [number, number, number]) =>
        Math.abs(c.r - t[0]) + Math.abs(c.g - t[1]) + Math.abs(c.b - t[2]) < 30
      expect(q.palette.some((c) => near(c, [12, 12, 12])), 'чёрный').toBe(true)
      expect(q.palette.some((c) => near(c, [190, 25, 25])), 'красный').toBe(true)
      expect(q.palette.some((c) => near(c, [240, 240, 240])), 'белый').toBe(true)
      // Палитра упорядочена от тёмного к светлому.
      for (let k = 1; k < q.palette.length; k++) {
        const a = q.palette[k - 1]!
        const b = q.palette[k]!
        expect(luma(a.r, a.g, a.b)).toBeLessThanOrEqual(luma(b.r, b.g, b.b))
      }
    })
  }

  it('prints every pixel in the filament of its own color', () => {
    const rgba = logoOnDark()
    const q = mapToLuminanceBands(rgba, 3, W, H, false, 0)
    for (let i = 0; i < W * H; i++) {
      const c = q.palette[q.indexMap[i]!]!
      const p = i * 4
      expect(Math.abs(c.r - rgba[p]!) + Math.abs(c.g - rgba[p + 1]!) + Math.abs(c.b - rgba[p + 2]!)).toBeLessThan(30)
    }
  })

  it('keeps the relief ordered by brightness and inside each band', () => {
    const q = mapToLuminanceBands(logoOnDark(), 3, W, H, false, 0)
    const n = q.palette.length
    for (let i = 0; i < W * H; i++) {
      const slice = q.indexMap[i]!
      const lo = slice === 0 ? 0 : q.bandTops[slice - 1]!
      const hi = q.bandTops[slice]!
      expect(q.luminance[i]!).toBeGreaterThanOrEqual(lo - 1e-6)
      expect(q.luminance[i]!).toBeLessThanOrEqual(hi + 1e-6)
    }
    expect(q.bandTops[n - 1]).toBe(1)
  })
})

/** Sky gradient blue → orange, a small yellow sun, two green hills. */
function sunset(W = 300, H = 200): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4)
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = Math.min(1, y / (H * 0.62))
      let c = [lerp(0x1d, 0xf4, t), lerp(0x4e, 0xa2, t), lerp(0x89, 0x59, t)]
      if ((x - 210) ** 2 + (y - 112) ** 2 < 22 ** 2) c = [0xff, 0xe2, 0x8a]
      if (y > 135 + 15 * Math.sin(x / 50)) c = [0x2f, 0x5d, 0x3a]
      if (y > 165 + 8 * Math.cos(x / 40)) c = [0x1b, 0x33, 0x24]
      rgba.set([c[0]!, c[1]!, c[2]!, 255], (y * W + x) * 4)
    }
  }
  return rgba
}

describe('small distinct details keep their own filament', () => {
  it('keeps the sun (≈2.5 % of the picture) as the lightest filament', () => {
    // The mid-tone of the sky is a blend of its blue and orange ends; the
    // yellow sun is not, so with only four colors the sun must still get one.
    const q = mapToLuminanceBands(sunset(), 4, 300, 200, false, 0)
    const lightest = q.palette[q.palette.length - 1]!
    expect(lightest.r).toBeGreaterThan(240)
    expect(lightest.g).toBeGreaterThan(210)
    expect(lightest.b).toBeLessThan(160)
    // The sun's centre prints in that filament.
    expect(q.indexMap[112 * 300 + 210]).toBe(q.palette.length - 1)
  })

  it('always keeps the darkest and the lightest color of the picture', () => {
    const q = mapToLuminanceBands(logoOnDark(), 2, W, H, false, 0)
    expect(luma(q.palette[0]!.r, q.palette[0]!.g, q.palette[0]!.b)).toBeLessThan(20)
    expect(luma(q.palette[1]!.r, q.palette[1]!.g, q.palette[1]!.b)).toBeGreaterThan(200)
  })
})

/**
 * Checked against a HueForge STL and its source picture (a battleship in a
 * storm): HueForge's surface height is linear in the picture's brightness
 * (r = 0.92 over the whole print, 0.48 mm base, 2.24 mm in all, 0.08 mm
 * layers), and its filaments step from the darkest to the lightest color.
 */
describe('HueForge Standard relief', () => {
  /** Horizontal 0 → 255 gray ramp, `w` × `h`. */
  function ramp(w: number, h: number): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Math.round((x / (w - 1)) * 255)
        rgba.set([v, v, v, 255], (y * w + x) * 4)
      }
    }
    return rgba
  }

  it('puts every pixel at base + brightness × relief, within one layer', () => {
    const w = 64
    const h = 8
    const rgba = ramp(w, h)
    const q = mapToLuminanceBands(rgba, 4, w, h, false, 0)
    const result = finishPipeline({ width: w, height: h, rgba }, q, {
      numColors: 4,
      darkIsTall: false,
      widthMm: 64 * 0.4,
      heightMm: 8 * 0.4,
      baseMm: 0.48,
      maxHeightMm: 2.24,
      layerMm: 0.08,
    })
    for (let i = 0; i < w * h; i++) {
      const p = i * 4
      const brightness = (0.2126 * rgba[p]! + 0.7152 * rgba[p + 1]! + 0.0722 * rgba[p + 2]!) / 255
      const expected = 0.48 + brightness * (2.24 - 0.48)
      expect(Math.abs(result.field.values[i]! - expected)).toBeLessThanOrEqual(0.08 + 1e-6)
    }
  })

  it('does not stretch a dim picture to the full height', () => {
    // A picture that only reaches half brightness only reaches half the relief.
    const w = 32
    const h = 4
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const v = Math.round(((i % w) / (w - 1)) * 128)
      rgba.set([v, v, v, 255], i * 4)
    }
    const q = mapToLuminanceBands(rgba, 3, w, h, false, 0)
    expect(Math.max(...q.luminance)).toBeLessThan(0.55)
  })

  it('steps the palette dark → light and ignores a tiny odd color', () => {
    // A storm at sea: a dark-blue sea and sky, a gray ship, white spray — and
    // a small red flag (0.4 % of the picture) that must not become a filament.
    const w = 100
    const h = 60
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = y / (h - 1)
        let c = [Math.round(10 + 40 * t), Math.round(32 + 70 * t), Math.round(50 + 90 * t)]
        if (x >= 30 && x < 70 && y >= 20 && y < 40) c = [150, 160, 170]
        if (x >= 40 && x < 50 && y >= 15 && y < 20) c = [235, 240, 245]
        if (x >= 31 && x < 35 && y >= 21 && y < 27) c = [200, 40, 50]
        rgba.set([c[0]!, c[1]!, c[2]!, 255], (y * w + x) * 4)
      }
    }
    const q = mapToLuminanceBands(rgba, 4, w, h, false, 0)
    for (let k = 1; k < q.palette.length; k++) {
      const a = q.palette[k - 1]!
      const b = q.palette[k]!
      expect(luma(b.r, b.g, b.b)).toBeGreaterThanOrEqual(luma(a.r, a.g, a.b))
    }
    for (const c of q.palette) expect(c.r - Math.max(c.g, c.b), 'no red filament').toBeLessThan(40)
    // The ends are the picture's darkest navy and its white spray.
    expect(luma(q.palette[0]!.r, q.palette[0]!.g, q.palette[0]!.b)).toBeLessThan(45)
    expect(luma(q.palette[3]!.r, q.palette[3]!.g, q.palette[3]!.b)).toBeGreaterThan(200)
  })
})
