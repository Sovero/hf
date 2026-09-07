import { describe, it, expect } from 'vitest'
import { layerView } from '../lib/layerView'
import { finishPipeline } from '../lib/pipeline'
import type { PipelineResult } from '../lib/pipeline'
import { columnColor } from '../lib/transmission'
import type { LoadedImage, QuantizedImage, RGB } from '../lib/types'

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

/** Column tops in slice order (bottom → top), darkIsTall, base 0.8, usable 7.2. */
const TOPS = [2.6, 4.4, 6.2, 8]
const paletteOf = (result: PipelineResult, slice: number) =>
  result.quantized.palette[result.settings.darkIsTall ? result.quantized.palette.length - 1 - slice : slice]

describe('layerView', () => {
  it('below the base shows the bottom filament everywhere (first printed color)', () => {
    const result = makeResult()
    const view = layerView(result, 0.4)
    const bottomColor = paletteOf(result, 0) // lightest = printed first under darkIsTall
    for (let i = 0; i < 4; i++) {
      expect(view.rgba[i * 4]).toBe(bottomColor.r)
      expect(view.rgba[i * 4 + 1]).toBe(bottomColor.g)
      expect(view.rgba[i * 4 + 2]).toBe(bottomColor.b)
      expect(view.rgba[i * 4 + 3]).toBe(255)
    }
    expect(view.activeBand).toBe(0)
  })

  it('at the model top each column shows its transmitted blend (thin sheets let lower colors through)', () => {
    const result = makeResult()
    const view = layerView(result, 8)
    for (let i = 0; i < 4; i++) {
      const slice = 3 - result.quantized.indexMap[i] // darkIsTall: slice = n-1-idx
      const expected = columnColor(result, TOPS[slice])
      expect(view.rgba[i * 4]).toBe(Math.round(expected.r))
      expect(view.rgba[i * 4 + 1]).toBe(Math.round(expected.g))
      expect(view.rgba[i * 4 + 2]).toBe(Math.round(expected.b))
    }
    // Physics spot-check (darkIsTall): pixel 0 is black (slice 3, tallest,
    // full 4-sheet stack). The white sheets beneath shine through the black
    // top sheet, lifting it well above 0 — the signature HueForge effect.
    const tallestBlack = view.rgba[0]
    expect(tallestBlack).toBeGreaterThan(0)
    expect(tallestBlack).toBeLessThan(85)
    // Pixel 3 is white (slice 0 = bottom band): one white sheet directly on
    // the opaque base → no lower color to show through → stays pure white.
    const shortestWhite = view.rgba[3 * 4]
    expect(shortestWhite).toBe(255)
  })

  it('mid-print: finished columns show their transmitted blend, growing ones the active band', () => {
    const result = makeResult()
    const z = 5 // band 2 (top 6.2) is active: bands 0 (2.6) and 1 (4.4) finished below it
    const view = layerView(result, z)
    expect(view.activeBand).toBe(2)
    const activeColor = paletteOf(result, view.activeBand)
    for (let i = 0; i < 4; i++) {
      const slice = result.quantized.palette.length - 1 - result.quantized.indexMap[i]
      if (TOPS[slice] <= z + 1e-9) {
        const expected = columnColor(result, TOPS[slice])
        expect(view.rgba[i * 4]).toBe(Math.round(expected.r))
        expect(view.rgba[i * 4 + 1]).toBe(Math.round(expected.g))
      } else {
        expect(view.rgba[i * 4]).toBe(activeColor.r)
        expect(view.rgba[i * 4 + 1]).toBe(activeColor.g)
      }
    }
  })

  it('reports the 1-indexed layer containing z and the total layer count', () => {
    const result = makeResult()
    expect(layerView(result, 0.4).layer).toBe(2) // same convention as describe.ts layerAt
    expect(layerView(result, 1.0).layer).toBe(5)
    const top = layerView(result, 8)
    expect(top.totalLayers).toBe(40)
    expect(top.layer).toBe(40)
  })

  it('z above the model top clamps to the top layer', () => {
    const result = makeResult()
    const view = layerView(result, 99)
    expect(view.layer).toBe(40)
    expect(view.activeBand).toBe(3)
  })
})
