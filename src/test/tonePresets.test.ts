import { describe, it, expect } from 'vitest'
import { TONE_PRESETS, matchTonePreset, presetPercents, tonePreset } from '../lib/tonePresets'
import { mapToLuminanceBands, TONE_CONTRAST_MAX, TONE_CONTRAST_MIN, TONE_POWER_MAX, TONE_POWER_MIN } from '../lib/quantize'
import { finishPipeline, type PipelineOptions } from '../lib/pipeline'
import { measureRelief, type ReliefMetrics } from '../lib/reliefCompare'

describe('relief presets: definition', () => {
  it('stays inside the range the sliders allow', () => {
    for (const preset of TONE_PRESETS) {
      expect(preset.contrast).toBeGreaterThanOrEqual(TONE_CONTRAST_MIN)
      expect(preset.contrast).toBeLessThanOrEqual(TONE_CONTRAST_MAX)
      expect(preset.power).toBeGreaterThanOrEqual(TONE_POWER_MIN)
      expect(preset.power).toBeLessThanOrEqual(TONE_POWER_MAX)
    }
  })

  it('lands on the slider step, so a preset is exactly representable', () => {
    for (const preset of TONE_PRESETS) {
      const { contrast, power } = presetPercents(preset)
      expect(contrast % 10).toBe(0)
      expect(power % 10).toBe(0)
      // …and the percent values round-trip back to the multipliers the preset
      // documents, which is what the sliders will send to the pipeline.
      expect(contrast / 100).toBeCloseTo(preset.contrast, 9)
      expect(power / 100).toBeCloseTo(preset.power, 9)
    }
  })

  it('gives every preset its own setting and its own id', () => {
    const ids = TONE_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    const keys = TONE_PRESETS.map((p) => `${p.contrast}/${p.power}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps the picture’s own tones as one of the styles', () => {
    const photo = tonePreset('photo')
    expect(photo.contrast).toBe(1)
    expect(photo.power).toBe(1)
  })

  it('throws for an unknown id', () => {
    expect(() => tonePreset('nope' as never)).toThrow()
  })
})

describe('relief presets: matching the sliders', () => {
  it('recognises a preset from its slider values', () => {
    for (const preset of TONE_PRESETS) {
      const { contrast, power } = presetPercents(preset)
      expect(matchTonePreset(contrast / 100, power / 100)).toBe(preset.id)
    }
  })

  it('reports no preset for a hand-made or fitted setting', () => {
    expect(matchTonePreset(0.8, 3)).toBeNull()
    expect(matchTonePreset(1.3, 3)).toBeNull()
    expect(matchTonePreset(1.1, 2.2)).toBeNull()
  })

  it('is not fooled by a value that is merely close', () => {
    expect(matchTonePreset(1.31, 2.5)).toBeNull()
    expect(matchTonePreset(1.3, 2.51)).toBeNull()
  })
})

/** Gray ramp with tonal structure — the kind of picture the styles act on. */
function rampRgba(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const t = (x / (width - 1)) * 0.7 + (y / (height - 1)) * 0.3
      const v = Math.round(255 * Math.min(1, Math.max(0, t + 0.06 * Math.sin(x / 3))))
      rgba[i] = v
      rgba[i + 1] = v
      rgba[i + 2] = v
      rgba[i + 3] = 255
    }
  }
  return rgba
}

const WIDTH = 64
const HEIGHT = 64

function options(overrides: Partial<PipelineOptions> = {}): PipelineOptions {
  return {
    numColors: 4,
    darkIsTall: true,
    widthMm: 40,
    heightMm: 40,
    baseMm: 0.8,
    maxHeightMm: 8,
    layerMm: 0.2,
    dither: 0,
    ...overrides,
  }
}

/** Our own relief at one preset, measured with the reference instrument. */
function measurePreset(rgba: Uint8ClampedArray, preset: { contrast: number; power: number }): ReliefMetrics {
  const opts: PipelineOptions = { ...options(), contrast: preset.contrast, power: preset.power }
  const q = mapToLuminanceBands(rgba, opts.numColors, WIDTH, HEIGHT, opts.darkIsTall, 0, {
    contrast: preset.contrast,
    power: preset.power,
  })
  const result = finishPipeline({ width: WIDTH, height: HEIGHT, rgba: new Uint8ClampedArray(0) }, q, opts)
  return measureRelief(result.mesh.positions, result.mesh.triangleCount, {
    gridStepX: opts.widthMm / WIDTH,
    gridStepY: opts.heightMm / HEIGHT,
  })
}

/** Mean bin of a height profile: where the surface's mass sits, low → high. */
function massCentre(profile: readonly number[]): number {
  let sum = 0
  let weighted = 0
  for (let i = 0; i < profile.length; i++) {
    sum += profile[i]
    weighted += i * profile[i]
  }
  return sum > 0 ? weighted / sum : 0
}

/** Spread of a height profile around its own centre. */
function massSpread(profile: readonly number[]): number {
  const centre = massCentre(profile)
  let sum = 0
  let acc = 0
  for (let i = 0; i < profile.length; i++) {
    sum += profile[i]
    acc += profile[i] * (i - centre) ** 2
  }
  return sum > 0 ? acc / sum : 0
}

describe('relief presets: what the names promise', () => {
  const rgba = rampRgba(WIDTH, HEIGHT)
  const photo = measurePreset(rgba, tonePreset('photo'))
  const soft = measurePreset(rgba, tonePreset('soft'))
  const deep = measurePreset(rgba, tonePreset('deep'))
  const graphic = measurePreset(rgba, tonePreset('graphic'))

  it('«soft» bunches the surface together instead of spreading it', () => {
    // Pulling the tones towards the middle of the range concentrates the
    // heights: fewer distinct steps, gentler slopes.
    expect(massSpread(soft.heightProfile)).toBeLessThan(massSpread(photo.heightProfile))
    // …and it stays clear of the two extremes, so the preset cannot be
    // confused with «deep» or «graphic».
    expect(massSpread(soft.heightProfile)).toBeLessThan(massSpread(deep.heightProfile))
    expect(massSpread(soft.heightProfile)).toBeLessThan(massSpread(graphic.heightProfile))
  })

  it('«deep» sinks the surface towards the base', () => {
    expect(massCentre(deep.heightProfile)).toBeLessThan(massCentre(photo.heightProfile))
  })

  it('«graphic» spreads the surface further across the height range', () => {
    expect(massSpread(graphic.heightProfile)).toBeGreaterThan(massSpread(photo.heightProfile))
  })

  it('every preset still uses the whole relief range', () => {
    for (const metrics of [soft, photo, deep, graphic]) {
      // The curve pins both ends, so the tallest and lowest surface stay put.
      expect(metrics.sizeZ).toBeCloseTo(photo.sizeZ, 6)
    }
  })
})
