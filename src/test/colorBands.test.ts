import { describe, expect, it } from 'vitest'
import { mapToImageColors, mapToLuminanceBands } from '../lib/quantize'
import { enforceBandFloor } from '../lib/quantize'
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
    // Near-equal luma everywhere. The luminance path takes its filaments from
    // the picture's colors too, so neither of them is a red/blue mix. The color
    // path cuts the palette by RGB, so red stays red and blue stays blue.
    const luminance = mapToLuminanceBands(WEAVE, 2, W, H, true, 0)
    for (const c of luminance.palette) expect(c.r === 0 || c.b === 0, 'no red/blue mix').toBe(true)

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

  it('survives the printable band floor without leaving a band', () => {
    const q = mapToImageColors(WEAVE, 3, W, H, true, 0)
    const floored = enforceBandFloor(q.luminance, q.bandTops, 1 / 3)
    // Equal slices are already at the cap of the floor, so nothing moves.
    expect(floored.tops).toBe(q.bandTops)
    expect(floored.luminance).toBe(q.luminance)
  })
})

describe('color-first palette keeps the distinct colors', () => {
  /** Teal sky, green ground, a red suit (≈ 6 %), a dark visor and white glare. */
  function astronaut(): { rgba: Uint8ClampedArray; w: number; h: number } {
    const w = 120
    const h = 80
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = y / (h - 1)
        let c = [Math.round(60 + 60 * t), Math.round(190 + 30 * t), Math.round(180 - 20 * t)] // teal sky
        if (y > 58) c = [110, 150, 70] // green ground
        if ((x - 60) ** 2 + (y - 45) ** 2 < 15 ** 2) c = [200 - (y % 7) * 6, 40, 45] // red suit
        if ((x - 60) ** 2 + (y - 40) ** 2 < 6 ** 2) c = [20, 25, 40] // dark visor
        if (x > 100 && y < 6) c = [250, 252, 245] // glare
        rgba.set([c[0]!, c[1]!, c[2]!, 255], (y * w + x) * 4)
      }
    }
    return { rgba, w, h }
  }

  it('gives the red suit its own filament next to a big teal sky', () => {
    const { rgba, w, h } = astronaut()
    const q = mapToImageColors(rgba, 4, w, h, false, 0)
    expect(q.palette.some((c) => c.r > 150 && c.g < 90 && c.b < 90), 'red').toBe(true)
    expect(q.palette.some((c) => c.g > 170 && c.b > 140 && c.r < 140), 'teal').toBe(true)
    // The suit's pixels print in that red filament.
    const red = q.palette.findIndex((c) => c.r > 150 && c.g < 90)
    expect(q.indexMap[52 * w + 60]).toBe(red)
  })

  it('does not spend a filament on a speck of odd color', () => {
    const { rgba, w, h } = astronaut()
    // A 3×3 magenta speck (0.1 %) must not win a slot over the ground.
    for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) rgba.set([230, 30, 220, 255], (y * w + x) * 4)
    const q = mapToImageColors(rgba, 5, w, h, false, 0)
    expect(q.palette.some((c) => c.r > 180 && c.b > 180 && c.g < 80), 'magenta').toBe(false)
  })
})
