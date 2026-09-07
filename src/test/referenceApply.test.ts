import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { export3mfFile, finishPipeline } from '../lib/pipeline'
import { parseReference3mf } from '../lib/reference3mf'
import { planReferenceApply, reprocessWithReference } from '../lib/referenceApply'
import type { CurrentEditorOptions } from '../lib/referenceApply'
import type { QuantizedImage, RGB } from '../lib/types'

const PALETTE: RGB[] = [
  { r: 0, g: 0, b: 0 },
  { r: 85, g: 85, b: 85 },
  { r: 170, g: 170, b: 170 },
  { r: 255, g: 255, b: 255 },
]

const CURRENT: CurrentEditorOptions = {
  numColors: 4,
  darkIsTall: true,
  widthMm: 120,
  heightMm: 90,
  baseMm: 1,
  maxHeightMm: 10,
  layerMm: 0.2,
}

function image(w: number, h: number): { width: number; height: number; rgba: Uint8ClampedArray } {
  return { width: w, height: h, rgba: new Uint8ClampedArray(w * h * 4).fill(128) }
}

function fixture(): QuantizedImage {
  return {
    palette: PALETTE,
    indexMap: Uint8Array.from([0, 1, 2, 3]),
    luminance: Float32Array.from([0.9, 0.6, 0.35, 0.1]),
    bandTops: [0.25, 0.5, 0.75, 1],
    width: 2,
    height: 2,
  }
}

async function appReference(): Promise<Uint8Array> {
  const result = finishPipeline(image(2, 2), fixture(), {
    numColors: 4,
    darkIsTall: true,
    widthMm: 40,
    heightMm: 40,
    baseMm: 0.8,
    maxHeightMm: 8,
    layerMm: 0.2,
  })
  return export3mfFile(result, 'reference')
}

async function appAnalysis(): Promise<Awaited<ReturnType<typeof parseReference3mf>>> {
  return parseReference3mf(await appReference())
}

describe('planReferenceApply', () => {
  it('plans all representable fields from a complete app export', async () => {
    const plan = planReferenceApply(await appAnalysis(), CURRENT)

    expect(plan.canApply).toBe(true)
    expect(plan.options).toEqual({
      numColors: 4,
      darkIsTall: true,
      widthMm: 40,
      heightMm: 40,
      baseMm: 0.8,
      maxHeightMm: 8,
      layerMm: 0.2,
    })
    expect(plan.paletteOverride).toEqual([...PALETTE].sort((a, b) => a.r - b.r))
    expect(plan.bandTopsOverride).toEqual([0.25, 0.5, 0.75, 1])
    const applied = new Set(plan.fields.filter((f) => f.state === 'applied').map((f) => f.field))
    expect(applied).toEqual(new Set(['colorCount', 'widthMm', 'heightMm', 'baseMm', 'maxHeightMm', 'layerMm', 'depthMode', 'palette', 'schedule']))
  })

  it('blocks references with unsupported color counts instead of guessing', async () => {
    const threeColor = zipSync({
      '3D/3dmodel.model': strToU8(
        `<?xml version="1.0"?><model unit="millimeter"><metadata name="PaletteHex">#000000,#777777,#ffffff</metadata><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="10" y="10" z="4"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`,
      ),
    })
    const plan = planReferenceApply(await parseReference3mf(threeColor), CURRENT)

    expect(plan.canApply).toBe(false)
    expect(plan.blockedReason).toContain('3 colors')
  })

  it('falls back to the editor for missing base/layer metadata and keeps the current depth mode', async () => {
    const analysis = await appAnalysis()
    const withoutBase = { ...analysis, settings: { ...analysis.settings, baseMm: undefined, darkIsTall: undefined } }
    const plan = planReferenceApply(withoutBase, CURRENT)

    expect(plan.canApply).toBe(true)
    const stateOf = (field: string) => plan.fields.find((f) => f.field === field)?.state
    expect(stateOf('baseMm')).toBe('unavailable')
    expect(stateOf('depthMode')).toBe('applied') // dark printed last (order 4) → inferred darkIsTall
    expect(plan.options.darkIsTall).toBe(true)
    expect(plan.options.baseMm).toBe(CURRENT.baseMm)
  })

  it('infers darkIsTall when the reference prints dark colors last', () => {
    const base: Parameters<typeof planReferenceApply>[0] = {
      fileName: 'r.3mf',
      fileSizeBytes: 1,
      status: 'complete',
      model: { unit: 'millimeter', objectCount: 1, triangleCount: 1, vertexCount: 3, minX: 0, minY: 0, minZ: 0, maxX: 40, maxY: 40, maxZ: 8, widthMm: 40, heightMm: 40, maxHeightMm: 8 },
      palette: [
        { color: { r: 255, g: 255, b: 255 }, hex: '#ffffff', printOrder: 1, source: 'app-metadata' },
        { color: { r: 0, g: 0, b: 0 }, hex: '#000000', printOrder: 4, source: 'app-metadata' },
      ],
      swaps: [],
      settings: { colorCount: 2, widthMm: 40, heightMm: 40, maxHeightMm: 8, baseMm: 0.8, layerMm: 0.2 },
      missingFields: [],
      warnings: [],
      canApply: true,
    }
    const plan = planReferenceApply(base, CURRENT)

    expect(plan.canApply).toBe(true)
    expect(plan.options.darkIsTall).toBe(true)
  })

  it('rejects a schedule that cannot map onto the color count', async () => {
    const analysis = await appAnalysis()
    const badSchedule = { ...analysis, settings: { ...analysis.settings, bandTops: [0.5, 1] } }
    const plan = planReferenceApply(badSchedule, CURRENT)

    expect(plan.canApply).toBe(false)
    expect(plan.blockedReason).toContain('schedule')
  })

  it('recovers internal boundaries from Bambu-style per-layer tool changes', () => {
    const base: Parameters<typeof planReferenceApply>[0] = {
      fileName: 'b.3mf',
      fileSizeBytes: 1,
      status: 'partial',
      model: { unit: 'millimeter', objectCount: 1, triangleCount: 1, vertexCount: 3, minX: 0, minY: 0, minZ: 0, maxX: 20, maxY: 30, maxZ: 4, widthMm: 20, heightMm: 30, maxHeightMm: 4 },
      palette: [
        { color: { r: 0, g: 0, b: 0 }, hex: '#000000', printOrder: 1, source: 'filament-settings' },
        { color: { r: 255, g: 0, b: 0 }, hex: '#ff0000', printOrder: 2, extruder: 2, source: 'custom-gcode' },
      ],
      swaps: [
        { topZMm: 1.2, layer: 15, extruder: 1, hex: '#000000' },
        { topZMm: 2.4, layer: 30, extruder: 1, hex: '#000000' },
        { topZMm: 3.6, layer: 45, extruder: 2, hex: '#ff0000' },
      ],
      settings: { colorCount: 2, widthMm: 20, heightMm: 30, maxHeightMm: 4 },
      missingFields: [],
      warnings: [],
      canApply: true,
    }
    const plan = planReferenceApply(base, CURRENT)

    expect(plan.canApply).toBe(true)
    expect(plan.options.darkIsTall).toBe(false) // light red printed last → lightIsTall
    // Boundaries at the top of the last layer printed with each tool; the
    // reference carries no base metadata, so the editor's base (1 mm) applies.
    expect(plan.bandTopsOverride).toEqual([(2.4 - 1) / 3, 1])
    expect(plan.fields.find((f) => f.field === 'schedule')?.source).toBe('tool changes')
  })

  it('falls back to image-derived bands when tool changes carry no tool info', async () => {
    const analysis = await appAnalysis()
    const noTools = {
      ...analysis,
      swaps: analysis.swaps.map((s) => ({ ...s, extruder: undefined, hex: undefined })),
      settings: { ...analysis.settings, bandTops: undefined },
    }
    const plan = planReferenceApply(noTools, CURRENT)

    expect(plan.canApply).toBe(true)
    expect(plan.bandTopsOverride).toBeNull()
    expect(plan.fields.find((f) => f.field === 'schedule')?.state).toBe('fallback')
  })
})

describe('reprocessWithReference', () => {
  it('rebuilds the pipeline with the reference palette and schedule, keeping the image', async () => {
    const plan = planReferenceApply(await appAnalysis(), CURRENT)
    const src = image(6, 6)
    for (let i = 0; i < 36; i++) src.rgba.set([10 * (i % 6), 20 * (i % 6), 30 * Math.floor(i / 6), 255])
    const quantized = {
      palette: PALETTE,
      indexMap: new Uint8Array(36),
      luminance: new Float32Array(36),
      bandTops: [0.25, 0.5, 0.75, 1],
      width: 6,
      height: 6,
    }
    finishPipeline(src, quantized, {
      numColors: 4,
      darkIsTall: plan.options.darkIsTall,
      widthMm: CURRENT.widthMm,
      heightMm: CURRENT.heightMm,
      baseMm: CURRENT.baseMm,
      maxHeightMm: CURRENT.maxHeightMm,
      layerMm: CURRENT.layerMm,
    })
    const applied = reprocessWithReference(src, plan)

    expect(applied.image).toBe(src)
    expect(applied.settings).toEqual({
      widthMm: 40,
      heightMm: 40,
      baseMm: 0.8,
      maxHeightMm: 8,
      darkIsTall: plan.options.darkIsTall,
      layerMm: 0.2,
    })
    expect(applied.settings.widthMm).toBe(40)
    expect(applied.settings.maxHeightMm).toBe(8)
    expect(applied.quantized.palette).toEqual(plan.paletteOverride)
    expect(applied.palette.map((p) => p.topZMm).sort((a, b) => a - b)).toEqual(
      plan.bandTopsOverride!.map((t) => 0.8 + (8 - 0.8) * t),
    )
    expect(applied.mesh.triangleCount).toBeGreaterThan(0)
    expect(applied.mesh.positions.length).toBe(applied.mesh.triangleCount * 9)
  })

  it('throws on a blocked plan instead of silently applying', () => {
    const plan = planReferenceApply(
      {
        ...({
          fileName: 'x.3mf',
          fileSizeBytes: 1,
          status: 'partial',
          model: { unit: 'millimeter', objectCount: 1, triangleCount: 1, vertexCount: 3, minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1, widthMm: 1, heightMm: 1, maxHeightMm: 1 },
          palette: [],
          swaps: [],
          settings: {},
          missingFields: ['palette'],
          warnings: [],
          canApply: false,
          applyBlockedReason: 'No filament palette was found.',
        }),
      },
      CURRENT,
    )

    expect(() => reprocessWithReference(image(2, 2), plan)).toThrow('No filament palette was found.')
  })
})
