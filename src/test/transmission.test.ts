import { describe, it, expect } from 'vitest'
import { transmission, columnColor, transmittedBandColors } from '../lib/transmission'
import { finishPipeline } from '../lib/pipeline'
import type { PipelineResult } from '../lib/pipeline'
import type { LoadedImage, QuantizedImage, RGB } from '../lib/types'

describe('transmission model', () => {
  it('T(z) is 0 for zero thickness and saturates toward 1', () => {
    expect(transmission(0)).toBe(0)
    expect(transmission(0.1)).toBeLessThan(0.2)
    expect(transmission(1.2)).toBeCloseTo(1 - Math.exp(-1), 5) // τ thickness → 63%
    expect(transmission(12)).toBeGreaterThan(0.99)
  })

  it('each translucent sheet blends with the column beneath it', () => {
    const result = makeResult()
    // darkIsTall print order: white → gray170 → dark85 → black (bottom→top)
    const two = columnColor(result, 4.4) // white + gray170 sheet
    const four = columnColor(result, 8) // + dark85 + black sheets
    // Gray sheet over white: pulled down from 255 but stays above pure gray
    // (170) because the white below shines through.
    expect(two.r).toBeGreaterThan(170)
    expect(two.r).toBeLessThan(255)
    // Stacking darker sheets keeps darkening, but white still shows through
    // the full black top: the column never reaches 0.
    expect(four.r).toBeLessThan(two.r)
    expect(four.r).toBeGreaterThan(0)
  })

  it('a column of only the bottom sheet is pure (no lower color to blend)', () => {
    const result = makeResult()
    const c = columnColor(result, 2.6)
    expect(c.r).toBeCloseTo(255, 0) // lightest filament, single sheet on base
  })

  it('uses per-filament τ from quantized.tauMm', () => {
    // Print order bottom → top: white, gray170, dark85, black; slot 2 of the
    // quantized palette (dark → light) is the gray sheet printed second.
    const opaque = makeResult()
    opaque.quantized.tauMm = [1.2, 1.2, 0.1, 1.2] // gray sheet hides everything
    const trans = makeResult()
    trans.quantized.tauMm = [1.2, 1.2, 10, 1.2] // gray sheet, light passes through
    const grayOpaque = columnColor(opaque, 4.4) // white base + gray sheet
    const grayClear = columnColor(trans, 4.4)
    expect(grayOpaque.r).toBeCloseTo(170, 0) // white below fully covered
    expect(grayClear.r).toBeGreaterThan(240) // white shines through
    expect(grayClear.r).toBeGreaterThan(grayOpaque.r)
  })

  it('transmittedBandColors indexes the blended color of each band bottom → top', () => {
    const result = makeResult()
    const bands = transmittedBandColors(result)
    expect(bands).toHaveLength(4)
    expect(bands[0].r).toBeCloseTo(255, 0) // bottom band: pure sheet on base
    expect(bands[3].r).toBeGreaterThan(0) // black top lifted by sheets below
    expect(bands[3].r).toBeLessThan(bands[0].r)
  })
});

const PALETTE_4: RGB[] = [
  { r: 0, g: 0, b: 0 },
  { r: 85, g: 85, b: 85 },
  { r: 170, g: 170, b: 170 },
  { r: 255, g: 255, b: 255 },
]

function makeResult(): PipelineResult {
  const quantized: QuantizedImage = {
    palette: PALETTE_4,
    indexMap: Uint8Array.from([0, 1, 2, 3]),
    luminance: Float32Array.from([0.9, 0.6, 0.35, 0.1]),
    bandTops: [0.25, 0.5, 0.75, 1],
    width: 2,
    height: 2,
  }
  const image: LoadedImage = { width: 2, height: 2, rgba: new Uint8ClampedArray(2 * 2 * 4) }
  return finishPipeline(image, quantized, {
    numColors: 4, darkIsTall: true, widthMm: 40, heightMm: 40, baseMm: 0.8, maxHeightMm: 8, layerMm: 0.2,
  })
}
