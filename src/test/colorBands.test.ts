import { describe, expect, it } from 'vitest'
import { mapToImageColors, mapToLuminanceBands } from '../lib/quantize'
import { enforceBandFloor, relaxCliffs } from '../lib/quantize'
import { maxReliefStep } from '../lib/printConsts'
import type { QuantizedImage } from '../lib/types'

/**
 * Color-first quantization («цвета по изображению»): the palette is a median
 * cut of the picture's own RGB and every pixel takes the nearest color, with
 * each color owning one equal slice of the printed height.
 *
 * The contract worth pinning is the one the brightness model cannot meet: two
 * hues that share a brightness must still be two filaments, and a pixel's
 * relief must stay inside the slice of the color it prints in.
 */

/** Interleaved red/blue columns of exactly the same luma (≈ 18.3). */
function redBlueWeave(W = 20, H = 20): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4
      const blue = x % 2 === 0
      rgba[p] = blue ? 0 : 86
      rgba[p + 2] = blue ? 255 : 0
      rgba[p + 3] = 255
    }
  }
  return rgba
}

const W = 20
const H = 20
const WEAVE = redBlueWeave(W, H)

const sliceOf = (q: QuantizedImage, i: number, darkIsTall: boolean) => {
  const n = q.palette.length
  return darkIsTall ? n - 1 - q.indexMap[i]! : q.indexMap[i]!
}

describe('color-first palette (median cut)', () => {
  it('keeps the hues the brightness model averages into mud', () => {
    // Equal luma everywhere: the luminance path must split the pixels by rank,
    // which mixes both hues into every band and prints two indistinguishable
    // muddy colors. The color path cuts the palette by RGB, so red stays red
    // and blue stays blue.
    const luminance = mapToLuminanceBands(WEAVE, 2, W, H, true, 0)
    for (const c of luminance.palette) {
      expect(c.r).toBeGreaterThan(0)
      expect(c.b).toBeGreaterThan(0)
    }

    const image = mapToImageColors(WEAVE, 2, W, H, true, 0)
    const red = image.palette.find((c) => c.r > c.b * 2)
    const blue = image.palette.find((c) => c.b > c.r * 2)
    expect(red, 'a red filament').toBeDefined()
    expect(blue, 'a blue filament').toBeDefined()
    // The whole red column prints in red, the blue one in blue.
    const redSlot = image.palette.indexOf(red!)
    const blueSlot = image.palette.indexOf(blue!)
    for (let y = 0; y < H; y++) {
      expect(image.indexMap[y * W]!).toBe(blueSlot)
      expect(image.indexMap[y * W + 1]!).toBe(redSlot)
    }
  })

  it('orders the palette dark → light and fills the requested color count', () => {
    const q = mapToImageColors(WEAVE, 4, W, H, true, 0)
    expect(q.palette).toHaveLength(4)
    const luma = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
    for (let k = 1; k < q.palette.length; k++) {
      expect(luma(q.palette[k]!)).toBeGreaterThanOrEqual(luma(q.palette[k - 1]!))
    }
    expect(q.bandTops).toEqual([0.25, 0.5, 0.75, 1])
    expect(q.luminance).toHaveLength(W * H)
  })

  it('keeps every pixel inside the slice of the color it prints in', () => {
    for (const darkIsTall of [true, false]) {
      const q = mapToImageColors(WEAVE, 3, W, H, darkIsTall, 0)
      const n = q.palette.length
      for (let i = 0; i < W * H; i++) {
        const slice = sliceOf(q, i, darkIsTall)
        const lo = slice / n
        const hi = (slice + 1) / n
        expect(q.luminance[i]!, `pixel ${i}, darkIsTall=${darkIsTall}`).toBeGreaterThanOrEqual(lo - 1e-6)
        expect(q.luminance[i]!, `pixel ${i}, darkIsTall=${darkIsTall}`).toBeLessThanOrEqual(hi + 1e-6)
      }
    }
  })

  it('models shading inside a color, not a flat plateau', () => {
    // A vertical gradient inside one hue: the band keeps its own brightness
    // modelling, stretched over its slice, so the terrace is sculpted.
    const w = 6
    const h = 30
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = 40 + Math.round((y / (h - 1)) * 120)
        const p = (y * w + x) * 4
        rgba[p] = v
        rgba[p + 1] = Math.round(v * 0.6)
        rgba[p + 2] = Math.round(v * 0.4)
        rgba[p + 3] = 255
      }
    }
    const q = mapToImageColors(rgba, 1, w, h, false, 0)
    const top = q.luminance[h * w - 1]!
    const bottom = q.luminance[0]!
    expect(top - bottom).toBeGreaterThan(0.5)
  })

  it('keeps containment when dithering re-labels pixels', () => {
    const q = mapToImageColors(WEAVE, 2, W, H, true, 0.6)
    expect(q.cleanIndexMap).toBeDefined()
    const n = q.palette.length
    for (let i = 0; i < W * H; i++) {
      const lo = sliceOf(q, i, true) / n
      expect(q.luminance[i]!).toBeGreaterThanOrEqual(lo - 1e-6)
      expect(q.luminance[i]!).toBeLessThanOrEqual(lo + 1 / n + 1e-6)
    }
  })

  it('reads the palette from a smoother image than the labels', () => {
    // Noisy labels would otherwise drag the palette around: the caller passes
    // the smoothed image for the cut while the labels keep the detail.
    const clean = redBlueWeave(W, H)
    const noisy = clean.slice()
    for (let i = 0; i < noisy.length; i += 4) {
      if (i % 40 === 0) {
        noisy[i] = 255
        noisy[i + 1] = 255
        noisy[i + 2] = 255
      }
    }
    const q = mapToImageColors(noisy, 2, W, H, true, 0, clean)
    expect(q.palette.find((c) => c.r > c.b * 2)).toBeDefined()
    expect(q.palette.find((c) => c.b > c.r * 2)).toBeDefined()
  })

  it('slopes the height steps between colors instead of printing cliffs', () => {
    // Two blocks, one filament each: their boundaries are one whole slice tall
    // (1/n of the height) and vertical. The slope limit has to spread that step
    // into a ramp while leaving the flat interiors exactly as they were.
    const w = 60
    const h = 20
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4
        const left = x < w / 2
        rgba[p] = left ? 86 : 0
        rgba[p + 2] = left ? 0 : 255
        rgba[p + 3] = 255
      }
    }
    const q = mapToImageColors(rgba, 2, w, h, false, 0)
    const step = maxReliefStep(7.2, 0.2) // 45° face
    const raw = Math.abs(q.luminance[0]! - q.luminance[w - 1]!)
    expect(raw, 'the colours sit a half-height apart').toBeCloseTo(0.5, 3)

    const relaxed = relaxCliffs(q.luminance, w, h, step)
    let worst = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (x < w - 1) worst = Math.max(worst, Math.abs(relaxed[i]! - relaxed[i + 1]!))
        if (y < h - 1) worst = Math.max(worst, Math.abs(relaxed[i]! - relaxed[i + w]!))
      }
    }
    expect(worst, 'no face steeper than the limit').toBeLessThanOrEqual(step + 1e-6)
    // Flat interiors keep their own height: only the shoulder moves.
    expect(relaxed[0]).toBeCloseTo(q.luminance[0]!, 6)
    expect(relaxed[w - 1]).toBeCloseTo(q.luminance[w - 1]!, 6)
  })

  it('leaves an already-gentle surface alone', () => {
    const w = 8
    const h = 8
    const gentle = new Float32Array(w * h).map((_, i) => (i % w) * 0.02)
    const relaxed = relaxCliffs(gentle, w, h, 0.1)
    expect(Array.from(relaxed)).toEqual(Array.from(gentle))
  })

  it('survives the printable band floor without leaving a band', () => {
    const q = mapToImageColors(WEAVE, 3, W, H, true, 0)
    const floored = enforceBandFloor(q.luminance, q.bandTops, 1 / 3)
    // Equal slices are already at the cap of the floor, so nothing moves.
    expect(floored.tops).toBe(q.bandTops)
    expect(floored.luminance).toBe(q.luminance)
  })
})
