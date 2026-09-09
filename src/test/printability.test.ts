import { describe, it, expect } from 'vitest'
import { mapToLuminanceBands } from '../lib/quantize'
import { finishPipeline, type PipelineResult } from '../lib/pipeline'
import { analyzePrintability, fixFor } from '../lib/printability'
import type { ColorCount, PrintSettings } from '../lib/types'

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

type TestSettings = PrintSettings & { numColors: ColorCount }

function run(
  image: { width: number; height: number; rgba: Uint8ClampedArray },
  settings: TestSettings,
  dither = 0,
): PipelineResult {
  const q = mapToLuminanceBands(image.rgba, settings.numColors, image.width, image.height, settings.darkIsTall, dither)
  return finishPipeline(image, q, {
    numColors: settings.numColors,
    darkIsTall: settings.darkIsTall,
    widthMm: settings.widthMm,
    heightMm: settings.heightMm,
    baseMm: settings.baseMm,
    maxHeightMm: settings.maxHeightMm,
    layerMm: settings.layerMm,
    dither,
  })
}

describe('printability', () => {
  it('passes a comfortable configuration', () => {
    // 40 mm print, 64 px → 0.63 mm cells; 4 colors over 7.2 mm → 2.4 mm bands.
    const report = analyzePrintability(run(gradientImage(), {
      widthMm: 40, heightMm: 40, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, layerMm: 0.2, numColors: 4,
    }))
    expect(report.errors).toBe(0)
    expect(report.warnings).toBe(0)
    expect(report.checks.every((c) => c.level === 'ok')).toBe(true)
  })

  it('never flags bands at exactly one layer (float-dust safe)', () => {
    // 8 colors at max height 2.4 → usable 1.6 mm / 8 = exactly one 0.2 mm
    // layer per band: snappedBandTops forces every band to at least one layer
    // (monotonicity clamp), so the only way this could read as a sub-layer
    // band is float dust (0.2 vs 0.19999…). A one-layer band prints fine as a
    // distinct sheet — it must not fail.
    const report = analyzePrintability(run(gradientImage(), {
      widthMm: 150, heightMm: 150, baseMm: 0.8, maxHeightMm: 2.4, darkIsTall: true, layerMm: 0.2, numColors: 8,
    }))
    const bands = report.checks.find((c) => c.id === 'bands')!
    expect(bands.level).not.toBe('fail')
    expect(report.errors).toBe(0)
  })

  it('warns on bands thinner than the nozzle but thicker than a layer', () => {
    // 8 colors over 2.8 mm → 0.35 mm bands: below 0.4 mm nozzle, above 0.2 mm layer.
    const report = analyzePrintability(run(gradientImage(), {
      widthMm: 150, heightMm: 150, baseMm: 0.8, maxHeightMm: 3.6, darkIsTall: true, layerMm: 0.2, numColors: 8,
    }))
    const bands = report.checks.find((c) => c.id === 'bands')!
    expect(bands.level).toBe('warn')
  })

  it('warns when cells are smaller than the nozzle', () => {
    // 20 mm print at 64 px → 0.31 mm cells < 0.4 mm nozzle.
    const report = analyzePrintability(run(gradientImage(), {
      widthMm: 20, heightMm: 20, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, layerMm: 0.2, numColors: 4,
    }))
    const resolution = report.checks.find((c) => c.id === 'resolution')!
    expect(resolution.level).toBe('warn')
  })

  it('warns on many filament changes with a full palette', () => {
    // 8 colors = 7 changes, at or above the 6-change warning threshold.
    const report = analyzePrintability(run(gradientImage(), {
      widthMm: 150, heightMm: 150, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, layerMm: 0.2, numColors: 8,
    }))
    const swaps = report.checks.find((c) => c.id === 'swaps')!
    expect(swaps.level).toBe('warn')
    expect(swaps.detail).toContain('7')
  })

  it('keeps the change count below the threshold with few colors', () => {
    const report = analyzePrintability(run(gradientImage(), {
      widthMm: 150, heightMm: 150, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, layerMm: 0.2, numColors: 6,
    }))
    const swaps = report.checks.find((c) => c.id === 'swaps')!
    expect(swaps.level).toBe('ok')
    expect(swaps.detail).toContain('5')
  })

  it('flags fragile isolated regions on a checkerboard', () => {
    const report = analyzePrintability(run(checkerboardImage(32), {
      widthMm: 40, heightMm: 40, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, layerMm: 0.2, numColors: 2,
    }))
    const support = report.checks.find((c) => c.id === 'support')!
    expect(support.level).toBe('warn')
    expect(support.detail).toContain('no supports or true overhangs exist')
  })

  it('counts specks on the pre-dither map when dithering ran', () => {
    // A checkerboard quantized with dithering would show thousands of FS dots,
    // which are intentional gradient texture — the analysis must judge the
    // clean pre-dither map instead, so the warn decision matches the
    // no-dither run for the same image.
    const withDither = analyzePrintability(run(checkerboardImage(32), {
      widthMm: 40, heightMm: 40, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, layerMm: 0.2, numColors: 2,
    }, 0.6))
    const withoutDither = analyzePrintability(run(checkerboardImage(32), {
      widthMm: 40, heightMm: 40, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, layerMm: 0.2, numColors: 2,
    }))
    const support = withDither.checks.find((c) => c.id === 'support')!
    expect(support.level).toBe(withoutDither.checks.find((c) => c.id === 'support')!.level)
    // And the user is told the analysis is dither-aware.
    expect(support.detail).toContain('Dithering is on')
  })

  it('keeps the plain ok message when no dithering ran', () => {
    const report = analyzePrintability(run(gradientImage(), {
      widthMm: 40, heightMm: 40, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, layerMm: 0.2, numColors: 4,
    }))
    const support = report.checks.find((c) => c.id === 'support')!
    expect(support.level).toBe('ok')
    expect(support.detail).not.toContain('Dithering is on')
  })
})

describe('auto-fix (fixFor)', () => {
  it('raises max height so thin equal bands reach the nozzle width', () => {
    const result = run(gradientImage(), {
      widthMm: 150, heightMm: 150, baseMm: 0.8, maxHeightMm: 2.8, darkIsTall: true, layerMm: 0.2, numColors: 8,
    })
    // 0.25 mm bands: one layer thick (warn, not fail) but below the 0.4 nozzle.
    const before = analyzePrintability(result).checks.find((c) => c.id === 'bands')!
    expect(before.level).toBe('warn')
    const fix = fixFor('bands', result)
    expect(fix).not.toBeNull()
    expect(fix!.kind).toBe('maxHeight')
    expect((fix as { to: number }).to).toBeGreaterThan(2.8)
    // Applying the fix must make the check pass.
    const fixed = run(gradientImage(), {
      widthMm: 150, heightMm: 150, baseMm: 0.8, maxHeightMm: (fix as { to: number }).to, darkIsTall: true, layerMm: 0.2, numColors: 8,
    })
    const bands = analyzePrintability(fixed).checks.find((c) => c.id === 'bands')!
    expect(bands.level).not.toBe('warn')
    expect(bands.level).not.toBe('fail')
  })

  it('scales custom band heights up to the nozzle width', () => {
    const img = gradientImage()
    const q = mapToLuminanceBands(img.rgba, 4, img.width, img.height, true, 0)
    const heights = [0.05, 0.5, 0.5, 0.5] // thinnest band stacked on top
    const result = finishPipeline(img, q, {
      numColors: 4, darkIsTall: true, widthMm: 40, heightMm: 40,
      baseMm: 0.8, maxHeightMm: 2.35, layerMm: 0.3, dither: 0,
      bandHeightsMm: heights,
    })
    const before = analyzePrintability(result).checks.find((c) => c.id === 'bands')!
    expect(before.level).toBe('warn')
    const fix = fixFor('bands', result)
    expect(fix).not.toBeNull()
    expect(fix!.kind).toBe('bandHeights')
    const q2 = mapToLuminanceBands(img.rgba, 4, img.width, img.height, true, 0)
    const fixed = finishPipeline(img, q2, {
      numColors: 4, darkIsTall: true, widthMm: 40, heightMm: 40,
      baseMm: 0.8, maxHeightMm: 0.8 + (fix as { heights: number[] }).heights.reduce((a, c) => a + c, 0),
      layerMm: 0.3, dither: 0,
      bandHeightsMm: (fix as { heights: number[] }).heights,
    })
    const bands = analyzePrintability(fixed).checks.find((c) => c.id === 'bands')!
    expect(bands.level).not.toBe('warn')
    expect(bands.level).not.toBe('fail')
  })

  it('enlarges the print so cells reach the nozzle on a resolution warn', () => {
    const result = run(gradientImage(), {
      widthMm: 20, heightMm: 20, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, layerMm: 0.2, numColors: 4,
    })
    const fix = fixFor('resolution', result)
    expect(fix).not.toBeNull()
    expect(fix!.kind).toBe('size')
    const s = fix as { width: number; height: number }
    expect(s.width).toBeGreaterThan(20)
    expect(s.height).toBeGreaterThan(20)
    expect(s.width).toBeCloseTo(s.height, 5)
    // Re-running at the fixed size: cell = 25.6/64 = 0.4 ≥ nozzle.
    const fixed = run(gradientImage(), {
      widthMm: s.width, heightMm: s.height, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, layerMm: 0.2, numColors: 4,
    })
    const res = analyzePrintability(fixed).checks.find((c) => c.id === 'resolution')!
    expect(res.level).not.toBe('warn')
    expect(res.level).not.toBe('fail')
  })

  it('targets one layer on a hard resolution fail', () => {
    const result = run(gradientImage(), {
      widthMm: 20, heightMm: 20, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, layerMm: 0.4, numColors: 4,
    })
    const fix = fixFor('resolution', result)
    expect(fix).not.toBeNull()
    expect(fix!.kind).toBe('size')
    // 0.3125 mm cells → 0.4/0.3125 = 1.28× → 25.6 mm.
    expect((fix as { width: number }).width).toBeCloseTo(25.6, 1)
  })

  it('reduces the color count on a many-changes warning', () => {
    const result = run(gradientImage(), {
      widthMm: 150, heightMm: 150, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, layerMm: 0.2, numColors: 8,
    })
    expect(analyzePrintability(result).checks.find((c) => c.id === 'swaps')!.level).toBe('warn')
    const fix = fixFor('swaps', result)
    expect(fix).not.toBeNull()
    expect(fix!.kind).toBe('colors')
    expect((fix as { to: number }).to).toBe(6)
    // Applying the fix drops the change count below the threshold.
    const fixed = run(gradientImage(), {
      widthMm: 150, heightMm: 150, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, layerMm: 0.2, numColors: (fix as { to: number }).to as ColorCount,
    })
    const swaps = analyzePrintability(fixed).checks.find((c) => c.id === 'swaps')!
    expect(swaps.level).toBe('ok')
  })

  it('returns null for passing checks and non-fixable warnings', () => {
    const ok = run(gradientImage(), {
      widthMm: 40, heightMm: 40, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, layerMm: 0.2, numColors: 4,
    })
    expect(fixFor('bands', ok)).toBeNull()
    expect(fixFor('resolution', ok)).toBeNull()
    expect(fixFor('support', ok)).toBeNull()
    expect(fixFor('swaps', ok)).toBeNull()
    const swapsOk = run(gradientImage(), {
      widthMm: 150, heightMm: 150, baseMm: 0.8, maxHeightMm: 8, darkIsTall: true, layerMm: 0.2, numColors: 6,
    })
    expect(fixFor('swaps', swapsOk)).toBeNull()
    expect(fixFor('unknown', swapsOk)).toBeNull()
  })
})