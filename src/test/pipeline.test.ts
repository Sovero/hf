import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildHeightField } from '../lib/heightmap'
import { buildMesh } from '../lib/mesh'
import { quantize, mapToPalette } from '../lib/quantize'
import { sortByLuminance, luminance, hexToRgb, rgbToHex } from '../lib/palette'
import { generateBinaryStl } from '../lib/exportStl'
import { generate3mf } from '../lib/export3mf'
import { finishPipeline, exportFilename } from '../lib/pipeline'
import type { QuantizedImage, PrintSettings, RGB } from '../lib/types'

const PALETTE_4: RGB[] = [
  { r: 0, g: 0, b: 0 },
  { r: 85, g: 85, b: 85 },
  { r: 170, g: 170, b: 170 },
  { r: 255, g: 255, b: 255 },
]

function settings(overrides: Partial<PrintSettings> = {}): PrintSettings {
  return {
    widthMm: 40,
    heightMm: 40,
    baseMm: 0.8,
    maxHeightMm: 8,
    darkIsTall: true,
    ...overrides,
  }
}

function quantizedFixture(palette: RGB[] = PALETTE_4): QuantizedImage {
  // 2×2 image using all four palette colors.
  return { palette, indexMap: Uint8Array.from([0, 1, 2, 3]), width: 2, height: 2 }
}

describe('heightmap', () => {
  it('assigns taller bands to darker colors when darkIsTall', () => {
    const field = buildHeightField(quantizedFixture(), settings({ darkIsTall: true }))
    const step = (8 - 0.8) / 3
    expect(field.values[0]).toBeCloseTo(0.8 + 3 * step, 5)
    expect(field.values[3]).toBeCloseTo(0.8, 5)
  })

  it('assigns taller bands to lighter colors when darkIsTall=false', () => {
    const field = buildHeightField(quantizedFixture(), settings({ darkIsTall: false }))
    const step = (8 - 0.8) / 3
    expect(field.values[0]).toBeCloseTo(0.8, 5)
    expect(field.values[3]).toBeCloseTo(0.8 + 3 * step, 5)
  })
})

describe('mesh', () => {
  it('is watertight: every edge is shared by exactly two triangles', () => {
    const q = quantizedFixture()
    const field = buildHeightField(q, settings())
    const mesh = buildMesh(field, q.indexMap, q.palette, settings())
    expect(mesh.triangleCount).toBeGreaterThan(0)

    const edgeCount = new Map<string, number>()
    const p = mesh.positions
    for (let t = 0; t < mesh.triangleCount; t++) {
      const v: string[] = []
      for (let k = 0; k < 3; k++) {
        v.push(`${p[t * 9 + k * 3]},${p[t * 9 + k * 3 + 1]},${p[t * 9 + k * 3 + 2]}`)
      }
      for (let e = 0; e < 3; e++) {
        const a = v[e]
        const b = v[(e + 1) % 3]
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
      }
    }
    for (const count of edgeCount.values()) {
      expect(count).toBe(2)
    }
  })

  it('has outward winding and encodes the correct stepped-relief volume', () => {
    const q = quantizedFixture()
    const field = buildHeightField(q, settings())
    const mesh = buildMesh(field, q.indexMap, q.palette, settings())

    // Signed volume via divergence theorem must be positive (outward normals).
    const p = mesh.positions
    let volume6 = 0
    for (let t = 0; t < mesh.triangleCount; t++) {
      const i = t * 9
      const ax = p[i], ay = p[i + 1], az = p[i + 2]
      const bx = p[i + 3], by = p[i + 4], bz = p[i + 5]
      const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8]
      volume6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    }
    expect(volume6).toBeGreaterThan(0)

    // Volume = Σ cellArea × cellHeight. Cells are 20×20mm; heights per fixture:
    const step = (8 - 0.8) / 3
    const heights = [0.8 + 3 * step, 0.8 + 2 * step, 0.8 + step, 0.8]
    const expected = heights.reduce((sum, h) => sum + 20 * 20 * h, 0)
    expect(volume6 / 6).toBeCloseTo(expected, 3)
  })

  it('colors top faces with the cell palette color', () => {
    const q = quantizedFixture()
    const field = buildHeightField(q, settings())
    const mesh = buildMesh(field, q.indexMap, q.palette, settings())
    // First triangle is half of the first cell's top quad → darkest color.
    const r = mesh.colors[0] * 255
    expect(r).toBeCloseTo(0, 3)
  })
})

describe('quantize', () => {
  it('returns exactly numColors palette entries', () => {
    const rgba = new Uint8ClampedArray(64 * 4)
    for (let i = 0; i < 64; i++) {
      rgba[i * 4] = (i * 4) % 256
      rgba[i * 4 + 1] = (i * 7) % 256
      rgba[i * 4 + 2] = (i * 11) % 256
      rgba[i * 4 + 3] = 255
    }
    const palette = quantize(rgba, 8)
    expect(palette).toHaveLength(8)
  })

  it('handles a single-color image', () => {
    const rgba = new Uint8ClampedArray(4 * 4).fill(0)
    for (let i = 0; i < 4; i++) rgba[i * 4 + 3] = 255
    const palette = quantize(rgba, 4)
    expect(palette).toHaveLength(4)
    expect(palette[0]).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('maps every pixel to a valid palette index', () => {
    const rgba = new Uint8ClampedArray(8 * 4)
    for (let i = 0; i < 8; i++) {
      rgba[i * 4] = i * 30
      rgba[i * 4 + 1] = i * 30
      rgba[i * 4 + 2] = i * 30
      rgba[i * 4 + 3] = 255
    }
    const palette = quantize(rgba, 4)
    const result = mapToPalette(rgba, palette, 8, 1)
    expect(result.indexMap.every((idx) => idx >= 0 && idx < palette.length)).toBe(true)
  })
})

describe('palette', () => {
  it('sorts darkest → lightest by luminance', () => {
    const sorted = sortByLuminance([PALETTE_4[3], PALETTE_4[0], PALETTE_4[2], PALETTE_4[1]])
    expect(sorted).toEqual(PALETTE_4)
    expect(luminance(sorted[0])).toBeLessThan(luminance(sorted[3]))
  })

  it('round-trips hex colors', () => {
    expect(rgbToHex({ r: 255, g: 0, b: 16 })).toBe('#ff0010')
    expect(hexToRgb('#ff0010')).toEqual({ r: 255, g: 0, b: 16 })
  })
})

describe('STL export', () => {
  it('produces a valid binary STL (header, count, size)', () => {
    const q = quantizedFixture()
    const field = buildHeightField(q, settings())
    const mesh = buildMesh(field, q.indexMap, q.palette, settings())
    const buffer = generateBinaryStl(mesh)

    const view = new DataView(buffer)
    const declared = view.getUint32(80, true)
    expect(declared).toBe(mesh.triangleCount)
    expect(buffer.byteLength).toBe(84 + 50 * mesh.triangleCount)
  })
})

describe('3MF export', () => {
  it('produces a zip with a well-formed 3D model part', () => {
    const q = quantizedFixture()
    const field = buildHeightField(q, settings())
    const mesh = buildMesh(field, q.indexMap, q.palette, settings())
    const zip = generate3mf({ mesh, modelName: 'test', printSettings: { ColorCount: '4' } })

    const files = unzipSync(zip)
    expect(files['[Content_Types].xml']).toBeDefined()
    expect(files['_rels/.rels']).toBeDefined()
    const modelXml = strFromU8(files['3D/3dmodel.model'])

    expect(modelXml).toContain('<basematerials id="1">')
    expect(modelXml).toContain('<triangle v1=')
    expect(modelXml).toContain('<item objectid="2"/>')
    expect(modelXml).toContain('ColorCount')
    // Every material has a displaycolor.
    expect(modelXml).toMatch(/displaycolor="#[0-9a-f]{6}FF"/)
  })

  it('references a valid basematerials id on triangles', () => {
    const q = quantizedFixture()
    const field = buildHeightField(q, settings())
    const mesh = buildMesh(field, q.indexMap, q.palette, settings())
    const zip = generate3mf({ mesh, modelName: 'test' })
    const modelXml = strFromU8(unzipSync(zip)['3D/3dmodel.model'])

    const pidMatch = modelXml.match(/pid="(\d+)"/)
    expect(pidMatch).not.toBeNull()
    expect(modelXml).toContain(`<basematerials id="${pidMatch![1]}">`)
  })
})

describe('pipeline (finishPipeline)', () => {
  it('builds palette entries with heights and print order for darkIsTall', () => {
    const q = quantizedFixture()
    const img = { width: 2, height: 2, rgba: new Uint8ClampedArray(2 * 2 * 4).fill(128) }
    const result = finishPipeline(img, q, {
      numColors: 4,
      darkIsTall: true,
      widthMm: 40,
      heightMm: 40,
      baseMm: 0.8,
      maxHeightMm: 8,
    })

    expect(result.palette).toHaveLength(4)
    // darkest → printed last (order 4), tallest (8mm); lightest → order 1, at base
    expect(result.palette[0].printOrder).toBe(4)
    expect(result.palette[0].topZMm).toBeCloseTo(8, 5)
    expect(result.palette[3].printOrder).toBe(1)
    expect(result.palette[3].topZMm).toBeCloseTo(0.8, 5)
  })

  it('reverses print order for lightIsTall', () => {
    const q = quantizedFixture()
    const img = { width: 2, height: 2, rgba: new Uint8ClampedArray(2 * 2 * 4).fill(128) }
    const result = finishPipeline(img, q, {
      numColors: 4,
      darkIsTall: false,
      widthMm: 40,
      heightMm: 40,
      baseMm: 0.8,
      maxHeightMm: 8,
    })
    expect(result.palette[0].printOrder).toBe(1)
    expect(result.palette[3].printOrder).toBe(4)
  })

  it('builds descriptive export filenames from colors and mesh bounds', () => {
    const q = quantizedFixture()
    const img = { width: 2, height: 2, rgba: new Uint8ClampedArray(2 * 2 * 4).fill(128) }
    const result = finishPipeline(img, q, {
      numColors: 4,
      darkIsTall: true,
      widthMm: 40,
      heightMm: 40,
      baseMm: 0.8,
      maxHeightMm: 8,
    })
    expect(exportFilename(result, 'stl')).toBe('hueforge-4colors-40x40mm.stl')
    expect(exportFilename(result, '3mf')).toBe('hueforge-4colors-40x40mm.3mf')
  })

  it('keeps fractional dimensions readable in the filename', () => {
    const q = quantizedFixture()
    const img = { width: 2, height: 2, rgba: new Uint8ClampedArray(2 * 2 * 4).fill(128) }
    const result = finishPipeline(img, q, {
      numColors: 4,
      darkIsTall: true,
      widthMm: 20.5,
      heightMm: 30,
      baseMm: 0.8,
      maxHeightMm: 8,
    })
    expect(exportFilename(result, 'stl')).toBe('hueforge-4colors-20.5x30mm.stl')
  })
})
