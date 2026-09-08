import { describe, it, expect } from 'vitest'
import { transmission, columnColor, transmittedBandColors, backlitColumnColor, backlitBandColors, DEFAULT_TAU_MM } from '../lib/transmission'
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

  it('backlit fold starts from white and attenuates through every sheet including the base slab', () => {
    // darkIsTall=false → the bottom sheet is the darkest (black), so the base
    // slab is black. Front-lit treats it as an opaque floor: the bottom band
    // is pure black. Backlit folds incident white light through the black
    // sheet — it glows, the signature HueForge backlit look.
    const result = makeDarkBaseResult()
    const bottom = backlitColumnColor(result, 2.6)
    expect(bottom.r).toBeGreaterThan(0) // light leaks through the black slab
    const frontBottom = columnColor(result, 2.6)
    expect(frontBottom.r).toBeCloseTo(0, 0) // opaque floor reflects nothing
    expect(bottom.r).toBeGreaterThan(frontBottom.r)
    // Full stack: backlit stays above the front-lit floor (no black backdrop).
    const back = backlitColumnColor(result, 8)
    const front = columnColor(result, 8)
    expect(back.r).toBeGreaterThan(front.r)
  })

  it('backlit band colors are indexed bottom → top like the front-lit lookup', () => {
    const result = makeResult()
    const bands = backlitBandColors(result)
    expect(bands).toHaveLength(4)
    expect(bands[0].r).toBeCloseTo(255, 0) // white sheet, white slab: near-white
    expect(bands[3].r).toBeGreaterThan(0) // black top: light still leaks through
    expect(bands[3].r).toBeLessThan(bands[0].r)
  })

  it('a white base is invisible in backlight: backlit matches front-lit exactly', () => {
    // darkIsTall=true → the bottom sheet is white (255). White light folded
    // through a white sheet stays white, so the backlit stack is identical
    // to the front-lit stack over the opaque white base.
    const result = makeResult()
    const back = backlitColumnColor(result, 8)
    const front = columnColor(result, 8)
    expect(back.r).toBeCloseTo(front.r, 5)
    expect(back.g).toBeCloseTo(front.g, 5)
    expect(back.b).toBeCloseTo(front.b, 5)
  })

  it('a dark slab leaks a known amount of light (255·(1−T(z, τ)))', () => {
    // darkIsTall=false → the bottom sheet is black (0). Backlit, the slab is
    // not an opaque floor: white light leaks through it. At 2.6 mm with the
    // default τ=1.2, T = 1−e^(−2.6/1.2) ≈ 0.883 → leak ≈ 255·0.117 ≈ 29.9.
    const result = makeDarkBaseResult()
    const c = backlitColumnColor(result, 2.6)
    const expected = 255 * (1 - transmission(2.6, DEFAULT_TAU_MM))
    expect(c.r).toBeCloseTo(expected, 5)
    expect(c.g).toBeCloseTo(expected, 5)
    expect(c.b).toBeCloseTo(expected, 5)
  })
});

/** darkIsTall=false: the black filament prints first (bottom), the base slab is black. */
function makeDarkBaseResult(): PipelineResult {
  const quantized: QuantizedImage = {
    palette: PALETTE_4,
    indexMap: Uint8Array.from([0, 1, 2, 3]),
    luminance: Float32Array.from([0.1, 0.35, 0.6, 0.9]),
    bandTops: [0.25, 0.5, 0.75, 1],
    width: 2,
    height: 2,
  }
  const image: LoadedImage = { width: 2, height: 2, rgba: new Uint8ClampedArray(2 * 2 * 4) }
  return finishPipeline(image, quantized, {
    numColors: 4, darkIsTall: false, widthMm: 40, heightMm: 40, baseMm: 0.8, maxHeightMm: 8, layerMm: 0.2,
  })
}

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
