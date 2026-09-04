import { describe, it, expect } from 'vitest'
import { quantize, mapToLuminanceBands } from '../lib/quantize'
import { sortByLuminance } from '../lib/palette'
import { finishPipeline, type PipelineResult } from '../lib/pipeline'
import { analyzePrintability } from '../lib/printability'
import type { PrintSettings } from '../lib/types'

function gradientImage(size = 64): { width: number; height: number; rgba: Uint8ClampedArray } {
  const rgba = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.round(((x + y) / (2 * (size - 1))) * 255)
      const i = (y * size + x) * 4
      rgba[i] = v
      rgba[i + 1] = v
      rgba[i + 2] = v
      rgba[i + 3] = 255
    }
  }
  return { width: size, height: size, rgba }
}

function checkerboardImage(size = 32): { width: number; height: number; rgba: Uint8ClampedArray } {
  const rgba = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = (x + y) % 2 === 0 ? 20 : 235
      const i = (y * size + x) * 4
      rgba[i] = v
      rgba[i + 1] = v
      rgba[i + 2] = v
      rgba[i + 3] = 255
    }
  }
  return { width: size, height: size, rgba }
}

type TestSettings = PrintSettings & { numColors: 2 | 4 | 8 | 12 | 16 | 24 }

function run(image: { width: number; height: number; rgba: Uint8ClampedArray }, settings: TestSettings): PipelineResult {
  const rawPalette = quantize(image.rgba, settings.numColors)
  const palette = sortByLuminance(rawPalette)
  const q = mapToLuminanceBands(image.rgba, palette, image.width, image.height, settings.darkIsTall)
  return finishPipeline(image, q, {
    numColors: settings.numColors,
    darkIsTall: settings.darkIsTall,
    widthMm: settings.widthMm,
    heightMm: settings.heightMm,
    baseMm: settings.baseMm,
    maxHeightMm: settings.maxHeightMm,
  })
}

describe('printability', () => {
  it('passes a comfortable configuration', () => {
    // 40 mm print, 64 px → 0.63 mm cells; 4 colors over 7.2 mm → 2.4 mm bands.
    const report = analyzePrintability(run(gradientImage(), {
      widthMm: 40, heightMm: 40, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, numColors: 4,
    }))
    expect(report.errors).toBe(0)
    expect(report.warnings).toBe(0)
    expect(report.checks.every((c) => c.level === 'ok')).toBe(true)
  })

  it('flags bands thinner than one layer as an error', () => {
    // 24 colors squeezed into 2 mm of usable height → 0.087 mm bands.
    const report = analyzePrintability(run(gradientImage(), {
      widthMm: 150, heightMm: 150, baseMm: 0.8, maxHeightMm: 2.8, darkIsTall: true, numColors: 24,
    }))
    const bands = report.checks.find((c) => c.id === 'bands')!
    expect(bands.level).toBe('fail')
    expect(report.errors).toBeGreaterThanOrEqual(1)
  })

  it('warns on bands thinner than the nozzle but thicker than a layer', () => {
    // 24 colors over 7.2 mm → 0.31 mm bands: below 0.4 mm nozzle, above 0.2 mm layer.
    const report = analyzePrintability(run(gradientImage(), {
      widthMm: 150, heightMm: 150, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, numColors: 24,
    }))
    const bands = report.checks.find((c) => c.id === 'bands')!
    expect(bands.level).toBe('warn')
  })

  it('warns when cells are smaller than the nozzle', () => {
    // 20 mm print at 64 px → 0.31 mm cells < 0.4 mm nozzle.
    const report = analyzePrintability(run(gradientImage(), {
      widthMm: 20, heightMm: 20, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, numColors: 4,
    }))
    const resolution = report.checks.find((c) => c.id === 'resolution')!
    expect(resolution.level).toBe('warn')
  })

  it('warns on many filament changes', () => {
    const report = analyzePrintability(run(gradientImage(), {
      widthMm: 150, heightMm: 150, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, numColors: 24,
    }))
    const swaps = report.checks.find((c) => c.id === 'swaps')!
    expect(swaps.level).toBe('warn')
    expect(swaps.detail).toContain('23')
  })

  it('flags fragile isolated regions on a checkerboard', () => {
    const report = analyzePrintability(run(checkerboardImage(32), {
      widthMm: 40, heightMm: 40, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, numColors: 2,
    }))
    const support = report.checks.find((c) => c.id === 'support')!
    expect(support.level).toBe('warn')
    expect(support.detail).toContain('no supports or true overhangs exist')
  })
})