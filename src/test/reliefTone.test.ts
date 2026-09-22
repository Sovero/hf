import { describe, expect, it } from 'vitest'
import {
  TONE_CONTRAST_MAX,
  TONE_CONTRAST_MIN,
  TONE_POWER_MAX,
  TONE_POWER_MIN,
  applyTone,
  enforceBandFloor,
  mapToLuminanceBands,
} from '../lib/quantize'
import { NOZZLE_MM, minBandFraction } from '../lib/printConsts'
import { finishPipeline } from '../lib/pipeline'
import { snappedBandTops } from '../lib/heightmap'
import { buildProjectFile, parseProjectFile } from '../lib/project'
import type { PipelineOptions } from '../lib/pipeline'
import type { PrintSettings, RGB } from '../lib/types'

/**
 * Relief tone stage: the Filapaint / HueForge Standard pair of knobs — relief
 * «Contrast» and «Power Deepening» — applied to the relief values before the
 * color bands are ranked. The contract under test: heights move, colors and
 * the pixel → filament assignment do not, and a neutral value (or an absent
 * one) reproduces the untouched geometry exactly.
 */

/** Horizontal black→white ramp, one row per height. */
function gradientImage(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.round((x / (width - 1)) * 255)
      const p = (y * width + x) * 4
      rgba[p] = v
      rgba[p + 1] = v
      rgba[p + 2] = v
      rgba[p + 3] = 255
    }
  }
  return rgba
}

const W = 64
const H = 16
const RGBA = gradientImage(W, H)

const bands = (tone?: { contrast?: number; power?: number }) =>
  mapToLuminanceBands(RGBA, 4, W, H, true, 0, tone)

function options(overrides: Partial<PipelineOptions> = {}): PipelineOptions {
  return {
    numColors: 4,
    darkIsTall: true,
    widthMm: 40,
    heightMm: 40,
    baseMm: 0.8,
    maxHeightMm: 8,
    layerMm: 0.2,
    ...overrides,
  }
}

describe('relief tone curve', () => {
  it('is the identity for a missing, neutral or unusable setting', () => {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      expect(applyTone(v)).toBe(v)
      expect(applyTone(v, {})).toBe(v)
      expect(applyTone(v, { contrast: 1, power: 1 })).toBe(v)
      expect(applyTone(v, { contrast: Number.NaN, power: Number.POSITIVE_INFINITY })).toBe(v)
    }
  })

  it('clamps its input to the relief range', () => {
    expect(applyTone(-3, { contrast: 1 })).toBe(0)
    expect(applyTone(4, { contrast: 1 })).toBe(1)
    expect(applyTone(Number.NaN, { contrast: 1 })).toBe(0)
  })

  it('contrast pushes tones away from the middle and flattens them back', () => {
    // Both ends stay pinned — without that, saturated tones would leave their
    // own color band.
    expect(applyTone(0, { contrast: 2 })).toBeCloseTo(0, 10)
    expect(applyTone(1, { contrast: 2 })).toBeCloseTo(1, 10)
    expect(applyTone(0.5, { contrast: 2 })).toBeCloseTo(0.5, 10)
    // k = 2: each half of the range is squared (0.25 → 0.125, 0.75 → 0.875).
    expect(applyTone(0.25, { contrast: 2 })).toBeCloseTo(0.125, 10)
    expect(applyTone(0.75, { contrast: 2 })).toBeCloseTo(0.875, 10)
    // k = 0.5: the tones move toward the middle instead.
    expect(applyTone(0.25, { contrast: 0.5 })).toBeCloseTo(0.3535533906, 6)
    expect(applyTone(0.75, { contrast: 0.5 })).toBeCloseTo(0.6464466094, 6)
    // Nothing anywhere on the curve is saturated onto the ends.
    for (const v of [0.01, 0.1, 0.3, 0.9, 0.99]) {
      expect(applyTone(v, { contrast: 3 })).toBeGreaterThan(0)
      expect(applyTone(v, { contrast: 3 })).toBeLessThan(1)
    }
  })

  it('power deepens mid-tones and lifts them back', () => {
    expect(applyTone(0.5, { power: 2 })).toBeCloseTo(0.25, 10)
    expect(applyTone(0.25, { power: 0.5 })).toBeCloseTo(0.5, 10)
    expect(applyTone(0.5, { power: 2 })).toBeLessThan(0.5)
    expect(applyTone(0.5, { power: 0.5 })).toBeGreaterThan(0.5)
  })

  it('never inverts the order of two heights and stays inside 0..1', () => {
    for (const contrast of [TONE_CONTRAST_MIN, 0.5, 1, 2, TONE_CONTRAST_MAX]) {
      for (const power of [TONE_POWER_MIN, 0.5, 1, 2, TONE_POWER_MAX]) {
        let previous = -1
        for (let v = 0; v <= 1.0001; v += 0.05) {
          const out = applyTone(v, { contrast, power })
          expect(out).toBeGreaterThanOrEqual(0)
          expect(out).toBeLessThanOrEqual(1)
          expect(out).toBeGreaterThanOrEqual(previous - 1e-12)
          previous = out
        }
      }
    }
  })

  it('clamps settings outside the supported range instead of distorting the relief', () => {
    for (const v of [0.2, 0.5, 0.8]) {
      expect(applyTone(v, { contrast: -5 })).toBe(applyTone(v, { contrast: TONE_CONTRAST_MIN }))
      expect(applyTone(v, { contrast: 99 })).toBe(applyTone(v, { contrast: TONE_CONTRAST_MAX }))
      expect(applyTone(v, { power: 0 })).toBe(applyTone(v, { power: TONE_POWER_MIN }))
      expect(applyTone(v, { power: 99 })).toBe(applyTone(v, { power: TONE_POWER_MAX }))
    }
  })
})

describe('relief tone in the pipeline', () => {
  it('leaves the pixel → filament assignment and the palette untouched', () => {
    const neutral = bands()
    for (const tone of [{ contrast: 2 }, { contrast: 0.4 }, { power: 2 }, { power: 0.4 }, { contrast: 2, power: 1.5 }]) {
      const toned = bands(tone)
      expect([...toned.indexMap], JSON.stringify(tone)).toEqual([...neutral.indexMap])
      expect(toned.palette).toEqual(neutral.palette)
      expect(toned.cleanIndexMap).toBeUndefined()
    }
  })

  it('a neutral tone reproduces the untouched geometry byte for byte', () => {
    const base = finishPipeline(
      { width: W, height: H, rgba: RGBA },
      bands(),
      options(),
    )
    const neutral = finishPipeline(
      { width: W, height: H, rgba: RGBA },
      bands({ contrast: 1, power: 1 }),
      options({ contrast: 1, power: 1 }),
    )
    expect(neutral.field.values).toEqual(base.field.values)
    expect(neutral.mesh.positions).toEqual(base.mesh.positions)
    expect(neutral.settings.contrastPct).toBeUndefined()
    expect(neutral.settings.powerPct).toBeUndefined()
  })

  it('keeps every height inside the color band that owns the pixel', () => {
    // The property that makes the print read correctly: a pixel's surface has
    // to stay inside its own filament's slice, or the swap heights would show
    // the wrong color. Contrast and power move the heights *and* the band
    // boundaries together, so the containment survives them.
    for (const [label, tone] of Object.entries({
      neutral: {},
      sharp: { contrast: 2 },
      flat: { contrast: 0.4 },
      deep: { power: 2 },
      soft: { power: 0.5 },
      both: { contrast: 2, power: 2 },
    })) {
      const quantized = bands(tone)
      const result = finishPipeline({ width: W, height: H, rgba: RGBA }, quantized, options(tone))
      const tops = snappedBandTops(quantized, result.settings)
      const bandTops = quantized.bandTops
      const n = quantized.palette.length
      const values = Array.from(result.field.values)
      values.forEach((z, i) => {
        // Palette index k owns relief slice n-1-k in dark-is-tall mode.
        const slice = result.darkIsTall ? n - 1 - quantized.indexMap[i]! : quantized.indexMap[i]!
        const loZ = slice === 0 ? result.settings.baseMm : tops[slice - 1]!
        expect(z, label).toBeGreaterThanOrEqual(loZ - 1e-5)
        expect(z, label).toBeLessThanOrEqual(tops[slice]! + 1e-5)
        expect(quantized.luminance[i]!, label).toBeGreaterThanOrEqual(slice === 0 ? 0 : bandTops[slice - 1]!)
        expect(quantized.luminance[i]!, label).toBeLessThanOrEqual(bandTops[slice]!)
      })
      // Every pixel still reaches somewhere between the base and the top.
      expect(Math.min(...values), label).toBeGreaterThanOrEqual(result.settings.baseMm - 1e-9)
      expect(Math.max(...values), label).toBeLessThanOrEqual(result.settings.maxHeightMm + 1e-9)
    }
  })

  it('contrast widens the tonal spread, power lowers the mid-tones', () => {
    const relief = (tone: { contrast?: number; power?: number }) => {
      const q = bands(tone)
      const sorted = [...q.luminance].sort((a, b) => a - b)
      const at = (fraction: number) => sorted[Math.floor((sorted.length - 1) * fraction)]!
      const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length
      // Middle 80% of the relief: the extremes are pinned to 0..1 by the tone
      // curve on purpose, so only the interior tells the two knobs apart.
      return { spread: at(0.9) - at(0.1), mean, q }
    }
    const neutral = relief({})
    const sharp = relief({ contrast: 2 })
    const deep = relief({ power: 2 })

    expect(sharp.spread).toBeGreaterThan(neutral.spread)
    // v² pushes every interior value below v, so the mean height falls.
    expect(deep.mean).toBeLessThan(neutral.mean)
    // Band tops follow the toned values, so the color-change heights move with
    // the relief instead of being left behind.
    expect(sharp.q.bandTops).not.toEqual(neutral.q.bandTops)
  })

  it('records a non-neutral tone in the settings for exports', () => {
    const result = finishPipeline(
      { width: W, height: H, rgba: RGBA },
      bands({ contrast: 1.5, power: 2 }),
      options({ contrast: 1.5, power: 2 }),
    )
    expect(result.settings.contrastPct).toBe(150)
    expect(result.settings.powerPct).toBe(200)
  })
})

describe('relief tone in project files', () => {
  const palette: RGB[] = [
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 255, b: 255 },
  ]

  const file = (settings: Record<string, unknown>) =>
    buildProjectFile({
      imageName: 'test.png',
      dataUrl: 'data:image/png;base64,AAAA',
      settings: {
        colors: 2,
        widthMm: 40,
        heightMm: 40,
        baseMm: 0.8,
        maxMm: 8,
        layerMm: 0.2,
        dither: 0,
        darkIsTall: true,
        backlight: false,
        ...settings,
      },
      palette: palette.map((c) => ({ hex: '#000000', tauMm: 1.2, color: c })),
    })

  it('round-trips contrast and power', () => {
    const parsed = parseProjectFile(JSON.stringify(file({ contrast: 160, power: 70 })))
    expect(parsed.settings.contrast).toBe(160)
    expect(parsed.settings.power).toBe(70)
  })

  it('treats an absent tone as neutral (older projects keep their geometry)', () => {
    const parsed = parseProjectFile(JSON.stringify(file({})))
    expect(parsed.settings.contrast).toBeUndefined()
    expect(parsed.settings.power).toBeUndefined()
  })

  it('rejects an out-of-range or non-numeric tone', () => {
    for (const bad of [{ contrast: 400 }, { contrast: -10 }, { power: 5 }, { power: 500 }, { contrast: 'lots' }, { power: null }]) {
      expect(() => parseProjectFile(JSON.stringify(file(bad))), JSON.stringify(bad)).toThrow()
    }
  })
})

/**
 * Printable band floor: the tone curve moves the swap heights with the relief,
 * so a strong preset can squeeze a color into a single layer — a band the print
 * preview (rightly) renders as almost fully transparent, which is how a
 * picture's shadows melt into one muddy mass of the color below. The floor
 * keeps every band at least one nozzle wide without ever letting a pixel leave
 * the band it was assigned to.
 */
describe('printable band floor', () => {
  /** Shipped «deep relief» preset: contrast 130 %, power 250 %. */
  const DEEP = { contrast: 1.3, power: 2.5 }
  const settings: PrintSettings = {
    widthMm: 40,
    heightMm: 40,
    baseMm: 0.8,
    maxHeightMm: 8,
    darkIsTall: true,
    layerMm: 0.2,
  }

  it('is the nozzle width plus one layer of headroom, capped at an even split', () => {
    expect(minBandFraction(4, 7.2, 0.2)).toBeCloseTo((NOZZLE_MM + 0.2) / 7.2, 12)
    // More colors than the height can carry: the floor can only divide evenly.
    expect(minBandFraction(40, 7.2, 0.2)).toBeCloseTo(1 / 40, 12)
    expect(minBandFraction(4, 0, 0.2)).toBe(0)
    expect(minBandFraction(0, 7.2, 0.2)).toBeGreaterThan(0)
  })

  it('raises only the bands that are too thin and keeps the tops monotone', () => {
    const relief = new Float32Array([0, 0.2, 0.5, 0.9])
    const floored = enforceBandFloor(relief, [0.02, 0.5, 0.8], 0.1)
    expect(floored.tops[0]).toBeCloseTo(0.1, 12)
    expect(floored.tops[1]).toBeCloseTo(0.5, 12)
    // The top band always ends at 1: the maximum height is an input, and the
    // floor may only redistribute heights below it.
    expect(floored.tops[2]).toBeCloseTo(1, 12)
    for (let b = 1; b < floored.tops.length; b++) {
      expect(floored.tops[b]!).toBeGreaterThan(floored.tops[b - 1]!)
    }
  })

  it('keeps every pixel inside the band it was assigned to', () => {
    const relief = new Float32Array(200)
    for (let i = 0; i < relief.length; i++) relief[i] = i / (relief.length - 1)
    const tops = [0.02, 0.53, 0.81]
    const floored = enforceBandFloor(relief, tops, 0.15)
    relief.forEach((v, i) => {
      let band = 0
      while (band < tops.length - 1 && v > tops[band]!) band++
      const lo = band === 0 ? 0 : floored.tops[band - 1]!
      const hi = floored.tops[band]!
      expect(floored.luminance[i]!, `v=${v}`).toBeGreaterThanOrEqual(lo - 1e-9)
      expect(floored.luminance[i]!, `v=${v}`).toBeLessThanOrEqual(hi + 1e-9)
    })
  })

  it('leaves a healthy schedule byte-identical', () => {
    const quantized = bands({})
    const floored = enforceBandFloor(quantized.luminance, quantized.bandTops, minBandFraction(4, 7.2))
    expect(floored.luminance).toBe(quantized.luminance)
    expect(floored.tops).toBe(quantized.bandTops)
  })

  it('rescues the deep-relief preset from one-layer color bands', () => {
    const raw = mapToLuminanceBands(RGBA, 4, W, H, true, 0, DEEP)
    const rawTops = snappedBandTops(raw, settings)
    // The state the printability check flags: the bottom color gets one layer.
    expect(rawTops[0]! - settings.baseMm).toBeLessThan(NOZZLE_MM)

    const floored = mapToLuminanceBands(
      RGBA,
      4,
      W,
      H,
      true,
      0,
      DEEP,
      undefined,
      minBandFraction(4, settings.maxHeightMm - settings.baseMm, settings.layerMm),
    )
    const tops = snappedBandTops(floored, settings)
    let prev = settings.baseMm
    for (const top of tops) {
      expect(top - prev, `band under ${top} mm`).toBeGreaterThanOrEqual(NOZZLE_MM - 1e-9)
      prev = top
    }
  })
})
