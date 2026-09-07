import { describe, expect, it } from 'vitest'
import { mapToLuminanceBands } from '../lib/quantize'

/** Horizontal luma ramp: column x has luma x/(w-1) — clean bands are stripes. */
function rampImage(w = 64, h = 64): { rgba: Uint8ClampedArray; width: number; height: number } {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round((x / (w - 1)) * 255)
      const i = (y * w + x) * 4
      rgba[i] = v
      rgba[i + 1] = v
      rgba[i + 2] = v
      rgba[i + 3] = 255
    }
  }
  return { rgba, width: w, height: h }
}

function bands(rgba: Uint8ClampedArray, w: number, h: number, dither: number, darkIsTall = false) {
  return mapToLuminanceBands(rgba, 2, w, h, darkIsTall, dither)
}

describe('Floyd–Steinberg dithering', () => {
  it('strength 0 is byte-identical to omitting the parameter', () => {
    const { rgba, width, height } = rampImage()
    const off = bands(rgba, width, height, 0)
    const clean = mapToLuminanceBands(rgba, 2, width, height, false)
    expect([...off.indexMap]).toEqual([...clean.indexMap])
    expect(off.bandTops).toEqual(clean.bandTops)
  })

  it('dithers band boundaries into a mixed zone (2 bands, hard ramp)', () => {
    const { rgba, width, height } = rampImage()
    const clean = bands(rgba, width, height, 0)
    const dithered = bands(rgba, width, height, 1)

    // Filament colors and the swap schedule stay from the clean pass.
    expect(dithered.palette).toEqual(clean.palette)
    expect(dithered.bandTops).toEqual(clean.bandTops)

    // Diffusion re-labels some pixels…
    let changed = 0
    for (let i = 0; i < clean.indexMap.length; i++) {
      if (clean.indexMap[i] !== dithered.indexMap[i]) changed++
      expect(dithered.indexMap[i]).toBeLessThan(2)
    }
    expect(changed).toBeGreaterThan(0)
    expect(changed).toBeLessThan(clean.indexMap.length * 0.4) // localized, not chaos

    // …specifically around the single clean boundary (column ~31/32 with
    // darkIsTall=false: low columns are band 0). In a 6-column window the
    // dithered boundary mixes both labels; the clean one is a hard edge.
    const boundaryX = Math.round(width / 2)
    let mixed = 0
    for (let x = boundaryX - 3; x < boundaryX + 3; x++) {
      for (let y = 0; y < height; y++) {
        if (dithered.indexMap[y * width + x] !== clean.indexMap[y * width + x]) mixed++
      }
    }
    expect(mixed).toBeGreaterThan(0)
  })

  it('is deterministic and symmetric across depth modes', () => {
    const { rgba, width, height } = rampImage()
    const a = bands(rgba, width, height, 1, true)
    const b = bands(rgba, width, height, 1, true)
    expect([...a.indexMap]).toEqual([...b.indexMap])
    const light = bands(rgba, width, height, 1, false)
    const dark = bands(rgba, width, height, 1, true)
    // darkIsTall mirrors the relief; dithering must not crash or empty bands.
    for (const q of [light, dark]) {
      const counts = new Uint32Array(2)
      for (const l of q.indexMap) counts[l]++
      expect(counts[0]).toBeGreaterThan(0)
      expect(counts[1]).toBeGreaterThan(0)
    }
  })

  it('clamps out-of-range strengths', () => {
    const { rgba, width, height } = rampImage()
    const clampedHigh = bands(rgba, width, height, 5)
    const one = bands(rgba, width, height, 1)
    expect([...clampedHigh.indexMap]).toEqual([...one.indexMap])
    const clampedLow = bands(rgba, width, height, -3)
    const zero = bands(rgba, width, height, 0)
    expect([...clampedLow.indexMap]).toEqual([...zero.indexMap])
  })

  it('smoke: tiny images below the cleanup threshold still dither safely', () => {
    const { rgba, width, height } = rampImage(3, 3)
    const q = bands(rgba, width, height, 1)
    expect(q.indexMap.length).toBe(9)
  })
})
