import { describe, it, expect } from 'vitest'
import { mapToLuminanceBands } from '../lib/quantize'
import { finishPipeline, type PipelineResult } from '../lib/pipeline'
import { describeExport } from '../lib/describe'
import type { PrintSettings } from '../lib/types'

function gradientImage(size = 16): { width: number; height: number; rgba: Uint8ClampedArray } {
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

function run(settings: Partial<PrintSettings> & { numColors: 2 | 4 | 8 | 12 | 16 | 24 }): PipelineResult {
  const image = gradientImage()
  const q = mapToLuminanceBands(image.rgba, settings.numColors, image.width, image.height, settings.darkIsTall ?? true)
  return finishPipeline(image, q, {
    numColors: settings.numColors,
    darkIsTall: settings.darkIsTall ?? true,
    widthMm: settings.widthMm ?? 40,
    heightMm: settings.heightMm ?? 40,
    baseMm: settings.baseMm ?? 0.8,
    maxHeightMm: settings.maxHeightMm ?? 8,
    layerMm: settings.layerMm ?? 0.2,
  })
}

/** Every swap line: "Layer N (z = Z mm): switch to #hex · name" — N, Z and hex. */
function swapsOf(text: string): { layer: number; z: number }[] {
  return [...text.matchAll(/Layer (\d+) \(z = ([\d.]+) mm\): switch to #/g)].map((m) => ({
    layer: Number(m[1]),
    z: Number(m[2]),
  }))
}

describe('describeExport (Describe.txt companion)', () => {
  it('lists every filament bottom → top with height and layer ranges', () => {
    const result = run({ numColors: 4 })
    const text = describeExport(result, 'hueforge-4colors-40x40mm.txt')

    expect(text).toContain('HueForge Web — hueforge-4colors-40x40mm.txt')
    expect(text).toContain('Model size: 40.00 x 40.00 mm')
    expect(text).toContain('Base: 0.80 mm · max height: 8.00 mm')
    expect(text).toContain('Layer height: 0.20 mm (40 layers)')

    // One line per filament, numbered 1..4, sorted by height (bottom → top).
    const filamentLines = text.split('\n').filter((l) => /^\s+\d+\. #/.test(l))
    expect(filamentLines).toHaveLength(4)
    const zRanges = [...text.matchAll(/#[0-9a-f]{6} · .*? · height ([\d.]+)–([\d.]+) mm/g)]
    expect(zRanges.map((m) => Number(m[1]))).toEqual([...zRanges.map((m) => Number(m[1]))].sort((a, b) => a - b))
    expect(Number(zRanges[0][1])).toBe(0.8) // first band starts at the base
    expect(Number(zRanges[3][2])).toBe(8) // last band reaches max height
  })

  it('emits one swap per band boundary at increasing layers and heights', () => {
    const result = run({ numColors: 4 })
    const swaps = swapsOf(describeExport(result, 'm.txt'))

    expect(swaps).toHaveLength(3) // n - 1
    for (let i = 1; i < swaps.length; i++) {
      expect(swaps[i].layer).toBeGreaterThan(swaps[i - 1].layer)
      expect(swaps[i].z).toBeGreaterThan(swaps[i - 1].z)
    }
    // Every swap sits strictly inside the model height, exactly on the layer
    // grid of the chosen layer height (band tops are snapped to it).
    for (const s of swaps) {
      expect(s.z).toBeGreaterThan(0.8)
      expect(s.z).toBeLessThan(8)
      expect(s.layer).toBe(Math.round(s.z / 0.2))
    }
  })

  it('recomputes swap layers for the chosen layer height', () => {
    const base = run({ numColors: 4, layerMm: 0.2 })
    const fine = run({ numColors: 4, layerMm: 0.1 })

    // The same band boundaries, so halving the layer height doubles every
    // swap layer exactly.
    const baseLayers = swapsOf(describeExport(base, 'b.txt')).map((s) => s.layer)
    const fineLayers = swapsOf(describeExport(fine, 'f.txt')).map((s) => s.layer)
    expect(baseLayers).toHaveLength(3)
    expect(fineLayers).toEqual(baseLayers.map((l) => l * 2))
    expect(describeExport(fine, 'f.txt')).toContain('Layer height: 0.10 mm')
  })

  it('collapses sub-layer band boundaries into one swap per layer', () => {
    const fake = {
      settings: { widthMm: 10, heightMm: 10, baseMm: 1, maxHeightMm: 5, layerMm: 0.5, darkIsTall: true },
      palette: [
        { color: { r: 0, g: 0, b: 0 }, topZMm: 1.0, printOrder: 4 },
        { color: { r: 60, g: 60, b: 60 }, topZMm: 1.04, printOrder: 3 },
        { color: { r: 120, g: 120, b: 120 }, topZMm: 3.0, printOrder: 2 },
        { color: { r: 255, g: 255, b: 255 }, topZMm: 5.0, printOrder: 1 },
      ],
    } as PipelineResult
    const text = describeExport(fake, 'm.txt')
    const swaps = swapsOf(text)

    // Boundaries at z = 1.0 and z = 1.04 both round to layer 2 — one swap,
    // to the highest color starting at that layer (the 0.04 mm band never
    // owns a printable layer and is marked in the filament listing).
    expect(swaps).toHaveLength(2)
    expect(swaps[0]).toEqual({ layer: 2, z: 1.04 })
    expect(swaps[1]).toEqual({ layer: 6, z: 3 })
    expect(text).toContain('switch to #787878')
    expect(text).not.toContain('switch to #3c3c3c')
    expect(text).toContain('never printed (thinner than one layer)')
  })

  it('never suggests a swap past the total layer count', () => {
    // Extreme: max height just over one band at a coarse layer height.
    const result = run({ numColors: 8, layerMm: 0.6, maxHeightMm: 2.4 })
    const text = describeExport(result, 'x.txt')
    const total = Number(/Layer height: [\d.]+ mm \((\d+) layers\)/.exec(text)![1])
    for (const s of swapsOf(text)) {
      expect(s.layer).toBeGreaterThan(0)
      expect(s.layer).toBeLessThanOrEqual(total)
    }
  })
})