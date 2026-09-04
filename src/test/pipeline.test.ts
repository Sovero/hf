import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildHeightField } from '../lib/heightmap'
import { buildMesh } from '../lib/mesh'
import { quantize, mapToLuminanceBands } from '../lib/quantize'
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

/**
 * 2×2 fixture using all four palette colors. `luminance` holds the oriented
 * 0..1 relief position each pixel's column reaches (as the pipeline computes
 * it from brightness + darkIsTall): darkest colors are tall when darkIsTall.
 */
function quantizedFixture(palette: RGB[] = PALETTE_4): QuantizedImage {
  return {
    palette,
    indexMap: Uint8Array.from([0, 1, 2, 3]),
    luminance: Float32Array.from([0.9, 0.6, 0.35, 0.1]),
    width: 2,
    height: 2,
  }
}

describe('quantize → luminance bands', () => {
  it('splits a gray ramp into numColors brightness bands', () => {
    const size = 8
    const rgba = new Uint8ClampedArray(size * 4)
    for (let i = 0; i < size; i++) {
      const v = Math.round((i / (size - 1)) * 255)
      rgba[i * 4] = v
      rgba[i * 4 + 1] = v
      rgba[i * 4 + 2] = v
      rgba[i * 4 + 3] = 255
    }
    const q = mapToLuminanceBands(rgba, PALETTE_4, size, 1, false)
    expect(q.indexMap.length).toBe(size)
    expect(q.indexMap.every((idx) => idx >= 0 && idx < 4)).toBe(true)
    // Bright pixels must end in higher bands than dark ones (light = tall).
    expect(q.indexMap[0]).toBeLessThanOrEqual(q.indexMap[size - 1])
    expect(q.luminance[0]).toBeLessThan(q.luminance[size - 1])
  })

  it('inverts the relief when darkIsTall so dark pixels stand tallest', () => {
    const size = 4
    const rgba = new Uint8ClampedArray(size * 4)
    for (let i = 0; i < size; i++) {
      const v = Math.round((i / (size - 1)) * 255)
      rgba[i * 4] = v
      rgba[i * 4 + 1] = v
      rgba[i * 4 + 2] = v
      rgba[i * 4 + 3] = 255
    }
    const q = mapToLuminanceBands(rgba, PALETTE_4, size, 1, true)
    // Darkest pixel (first) must be the tallest and carry palette index 0.
    expect(q.luminance[0]).toBeGreaterThan(q.luminance[size - 1])
    expect(q.indexMap[0]).toBe(0)
    // Brightest pixel: shortest, lightest palette color printed first.
    expect(q.indexMap[size - 1]).toBe(3)
  })

  it('handles a single-color image without NaN', () => {
    const rgba = new Uint8ClampedArray(4 * 4).fill(0)
    for (let i = 0; i < 4; i++) rgba[i * 4 + 3] = 255
    const q = mapToLuminanceBands(rgba, PALETTE_4, 2, 2, false)
    for (const v of q.luminance) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('heightmap (brightness relief)', () => {
  it('maps the relief position linearly into base..max', () => {
    const q = quantizedFixture()
    const field = buildHeightField(q, settings())
    const usable = 8 - 0.8
    expect(field.values[0]).toBeCloseTo(0.8 + usable * 0.9, 5)
    expect(field.values[3]).toBeCloseTo(0.8 + usable * 0.1, 5)
  })

  it('keeps heights inside [baseMm, maxHeightMm]', () => {
    const q = quantizedFixture()
    const field = buildHeightField(q, settings({ baseMm: 0.8, maxHeightMm: 8 }))
    for (const v of field.values) {
      expect(v).toBeGreaterThanOrEqual(0.8)
      expect(v).toBeLessThanOrEqual(8)
    }
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

  it('has outward winding and encodes the correct relief volume', () => {
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

    // Volume = Σ cellArea × cellHeight (cells are 20×20 mm).
    const usable = 8 - 0.8
    const lum = [0.9, 0.6, 0.35, 0.1]
    const expected = lum.reduce((sum, t) => sum + 20 * 20 * (0.8 + usable * t), 0)
    expect(volume6 / 6).toBeCloseTo(expected, 3)
  })

  it('colors top faces with the cell palette color', () => {
    const q = quantizedFixture()
    const field = buildHeightField(q, settings())
    const mesh = buildMesh(field, q.indexMap, q.palette, settings())
    // Rows are mirrored vertically (photo top = far/max-Y edge), so the cell at
    // mesh y≈0 carries image row 1 → indexMap[2] = mid-gray.
    const r = mesh.colors[0] * 255
    expect(r).toBeCloseTo(170, 0)
  })

  it('mirrors image rows so the photo top ends at max Y (reads upright)', () => {
    // 2×2: image top row (y=0) = white (idx 3), bottom row = black (idx 0).
    const q = {
      palette: PALETTE_4,
      indexMap: Uint8Array.from([3, 3, 0, 0]),
      luminance: Float32Array.from([0.05, 0.05, 0.95, 0.95]),
      width: 2,
      height: 2,
    }
    const field = buildHeightField(q, settings())
    const mesh = buildMesh(field, q.indexMap, q.palette, settings())
    const p = mesh.positions
    const c = mesh.colors
    // Find top faces (flat in Z, above the base slab) and group by mesh Y band.
    const bandColor: { near: number; far: number } = { near: -1, far: -1 }
    for (let t = 0; t < mesh.triangleCount; t++) {
      const i = t * 9
      const zs = [p[i + 2], p[i + 5], p[i + 8]]
      const flat = Math.abs(zs[0] - zs[1]) < 1e-6 && Math.abs(zs[0] - zs[2]) < 1e-6
      if (!flat || zs[0] <= 0.5) continue // skip bottom (z=0) and wall quads
      const y0 = Math.round(p[i + 1])
      const red = Math.round(c[i] * 255)
      if (y0 < 20) bandColor.near = red
      else bandColor.far = red
    }
    // White (photo top) must be on the far band (y 20–40), black near (0–20).
    expect(bandColor.far).toBeGreaterThan(245)
    expect(bandColor.near).toBeLessThan(10)
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

describe('3MF export (Bambu Studio project)', () => {
  const fixture = (darkIsTall: boolean) => {
    const q = quantizedFixture()
    const img = { width: 2, height: 2, rgba: new Uint8ClampedArray(2 * 2 * 4).fill(128) }
    const result = finishPipeline(img, q, {
      numColors: 4, darkIsTall, widthMm: 40, heightMm: 40, baseMm: 0.8, maxHeightMm: 8,
    })
    return { mesh: result.mesh, bands: result.palette }
  }

  it('produces a Bambu Studio project package with mesh + Metadata', () => {
    const { mesh, bands } = fixture(true)
    const zip = generate3mf({ mesh, modelName: 'test', bands, printSettings: { ColorCount: '4' } })

    const files = unzipSync(zip)
    expect(files['[Content_Types].xml']).toBeDefined()
    expect(files['_rels/.rels']).toBeDefined()
    const modelXml = strFromU8(files['3D/3dmodel.model'])

    expect(modelXml).toContain('<triangle v1=')
    expect(modelXml).toContain('<item objectid="2"/>')
    expect(modelXml).toContain('ColorCount')
    // Bambu Studio project parts.
    expect(files['Metadata/custom_gcode_per_layer.xml']).toBeDefined()
    expect(files['Metadata/filament_settings_1.config']).toBeDefined()
    expect(files['Metadata/model_settings.config']).toBeDefined()
  })

  it('writes one tool change per band at whole-layer boundaries', () => {
    // Each band owns 1/4 of the usable height (0.8..8 → 1.8 mm per band), so
    // band tops sit at 2.6 / 4.4 / 6.2 — every printed layer between two
    // changes is a single color. darkIsTall: white is printed first (bottom,
    // shortest band), black last on top.
    const { mesh, bands } = fixture(true)
    const zip = generate3mf({ mesh, modelName: 'test', bands })
    const gcode = strFromU8(unzipSync(zip)['Metadata/custom_gcode_per_layer.xml'])

    expect(gcode).toContain('<mode value="MultiAsSingle"/>')
    // Print order bottom→top: white (2.6), gray170 (4.4), gray85 (6.2), black.
    expect(gcode).toContain(`extruder="2" color="#aaaaaa"`)
    expect(gcode).toContain(`extruder="3" color="#555555"`)
    expect(gcode).toContain(`extruder="4" color="#000000"`)
    const fmt = (v: number) => String(Number(v.toFixed(6)))
    expect(gcode).toContain(`top_z="${fmt(0.8 + 7.2 / 4)}"`) // 2.6
    expect(gcode).toContain(`top_z="${fmt(0.8 + (2 * 7.2) / 4)}"`) // 4.4
    expect(gcode).toContain(`top_z="${fmt(0.8 + (3 * 7.2) / 4)}"`) // 6.2
    // Exactly three changes for four colors — never two changes in one layer.
    const changes = gcode.match(/gcode="tool_change"/g) ?? []
    expect(changes).toHaveLength(3)
  })

  it('writes the base filament color into filament settings', () => {
    const { mesh, bands } = fixture(true)
    const zip = generate3mf({ mesh, modelName: 'test', bands })
    const filament = strFromU8(unzipSync(zip)['Metadata/filament_settings_1.config'])
    // Print order 1 = lightest (white) → the base color for Bambu.
    expect(filament).toContain('"#ffffff"')
    expect(filament).toContain('"inherits": "Generic PLA"')
  })

  it('reverses the swap schedule for lightIsTall', () => {
    const { mesh, bands } = fixture(false)
    const zip = generate3mf({ mesh, modelName: 'test', bands })
    const gcode = strFromU8(unzipSync(zip)['Metadata/custom_gcode_per_layer.xml'])
    // lightIsTall: black (order 1) at the base, then gray85, gray170, white on top.
    expect(gcode).toContain(`extruder="2" color="#555555"`)
    expect(gcode).toContain(`extruder="4" color="#ffffff"`)
  })
})

describe('pipeline (finishPipeline)', () => {
  it('builds palette entries with whole-layer band tops for darkIsTall', () => {
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
    // darkest → printed last (order 4), its band ends at the max height;
    // lightest → order 1, its band ends one band above the base.
    expect(result.palette[0].printOrder).toBe(4)
    expect(result.palette[0].topZMm).toBeCloseTo(8, 5)
    expect(result.palette[3].printOrder).toBe(1)
    expect(result.palette[3].topZMm).toBeCloseTo(0.8 + 7.2 / 4, 5)
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
    expect(result.palette[0].topZMm).toBeCloseTo(0.8 + 7.2 / 4, 5)
    expect(result.palette[3].printOrder).toBe(4)
    expect(result.palette[3].topZMm).toBeCloseTo(8, 5)
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
