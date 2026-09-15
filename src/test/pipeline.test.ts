import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildHeightField, snappedBandTops } from '../lib/heightmap'
import { buildMesh } from '../lib/mesh'
import { quantize, mapToLuminanceBands, removeIsolatedRegions, MIN_REGION_CELLS } from '../lib/quantize'
import { findIsolatedRegions } from '../lib/printability'
import { fitResolution, NOZZLE_MM } from '../lib/printConsts'
import { sortByLuminance, luminance, hexToRgb, rgbToHex } from '../lib/palette'
import { generateBinaryStl } from '../lib/exportStl'
import { generate3mf } from '../lib/export3mf'
import { finishPipeline, exportFilename } from '../lib/pipeline'
import type { Mesh, QuantizedImage, PrintSettings, RGB } from '../lib/types'

const PALETTE_4: RGB[] = [
  { r: 0, g: 0, b: 0 },
  { r: 85, g: 85, b: 85 },
  { r: 170, g: 170, b: 170 },
  { r: 255, g: 255, b: 255 },
]

describe('print resolution fit', () => {
  it('gives cells of at least one nozzle width for common print sizes', () => {
    expect(150 / fitResolution(150)).toBeGreaterThanOrEqual(NOZZLE_MM - 1e-9)
    expect(200 / fitResolution(200)).toBeGreaterThanOrEqual(NOZZLE_MM - 1e-9)
    expect(40 / fitResolution(40)).toBeGreaterThanOrEqual(NOZZLE_MM - 1e-9)
  })

  it('caps at MAX_DIMENSION and floors at 16 px', () => {
    expect(fitResolution(400)).toBeLessThanOrEqual(512)
    expect(fitResolution(5)).toBe(16)
  })
})

function settings(overrides: Partial<PrintSettings> = {}): PrintSettings {
  return {
    widthMm: 40,
    heightMm: 40,
    baseMm: 0.8,
    maxHeightMm: 8,
    darkIsTall: true,
    layerMm: 0.2,
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
    // Relief spans the full 0..1 range (0 = base, 1 = tallest) on the band
    // quantiles, so the extremes reach the base plate and the model top and
    // every pixel sits in the middle of its own band's slice.
    luminance: Float32Array.from([1, 2 / 3, 1 / 3, 0]),
    bandTops: [0.25, 0.5, 0.75, 1],
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
    const q = mapToLuminanceBands(rgba, 4, size, 1, false)
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
    const q = mapToLuminanceBands(rgba, 4, size, 1, true)
    // Darkest pixel (first) must be the tallest and carry palette index 0.
    expect(q.luminance[0]).toBeGreaterThan(q.luminance[size - 1])
    expect(q.indexMap[0]).toBe(0)
    // Brightest pixel: shortest, lightest palette color printed first.
    expect(q.indexMap[size - 1]).toBe(3)
  })

  it('handles a single-color image without NaN', () => {
    const rgba = new Uint8ClampedArray(4 * 4).fill(0)
    for (let i = 0; i < 4; i++) rgba[i * 4 + 3] = 255
    const q = mapToLuminanceBands(rgba, 4, 2, 2, false)
    for (const v of q.luminance) expect(Number.isFinite(v)).toBe(true)
  })

  it('derives band colors from the band contents (hue preserving)', () => {
    // 8 saturated squares at distinct brightness levels. Each luminance band
    // must take the hue its pixels actually have — the old median-cut palette
    // broke this: a blue square printed black, cyan printed yellow, etc.
    const colors: [number, number, number][] = [
      [0, 0, 255],     // blue    (darkest)
      [255, 0, 255],   // magenta
      [255, 0, 0],     // red
      [128, 128, 128], // gray
      [0, 255, 0],     // green
      [0, 255, 255],   // cyan
      [255, 255, 0],   // yellow
      [255, 255, 255], // white   (lightest)
    ]
    const w = 32
    const h = 16
    const cell = 8
    const rgba = new Uint8ClampedArray(w * h * 4)
    colors.forEach((c, i) => {
      const col = i % 4
      const row = Math.floor(i / 4)
      for (let y = row * cell; y < (row + 1) * cell; y++) {
        for (let x = col * cell; x < (col + 1) * cell; x++) {
          const p = (y * w + x) * 4
          rgba[p] = c[0]
          rgba[p + 1] = c[1]
          rgba[p + 2] = c[2]
          rgba[p + 3] = 255
        }
      }
    })
    const q = mapToLuminanceBands(rgba, 8, w, h, false)
    const pal = q.palette
    expect(pal[0].b).toBeGreaterThan(200)           // blue stays blue
    expect(pal[0].r).toBeLessThan(60)
    expect(pal[1].r).toBeGreaterThan(200)           // red+magenta → pink
    expect(pal[1].g).toBeLessThan(60)
    expect(Math.abs(pal[3].r - pal[3].g)).toBeLessThan(10) // gray stays gray
    expect(Math.abs(pal[3].g - pal[3].b)).toBeLessThan(10)
    expect(pal[1].r).toBeGreaterThan(200)           // red stays red
    expect(pal[1].g).toBeLessThan(60)
    expect(pal[2].r).toBeGreaterThan(200)           // magenta stays magenta
    expect(pal[2].b).toBeGreaterThan(200)
    expect(pal[4].g).toBeGreaterThan(pal[4].r + 40) // green stays green
    expect(pal[4].g).toBeGreaterThan(pal[4].b + 40)
    expect(pal[5].b).toBeGreaterThan(pal[5].r + 40) // cyan stays cyan
    expect(pal[5].g).toBeGreaterThan(pal[5].r + 40)
    expect(pal[6].r).toBeGreaterThan(200)           // yellow stays yellow
    expect(pal[6].g).toBeGreaterThan(200)
    expect(pal[6].b).toBeLessThan(100)
    expect(pal[7].r).toBeGreaterThan(250)           // white stays white
    expect(pal[7].g).toBeGreaterThan(250)
    expect(pal[7].b).toBeGreaterThan(250)
  })

  it('gives every band at least a minimum share of the image', () => {
    // A 5% dark sliver on a 95% mid-gray field: equal-population bands must
    // still hand every color ≈1/8 of the pixels, so no filament occupies a
    // negligible painted area.
    const w = 40
    const h = 20
    const rgba = new Uint8ClampedArray(w * h * 4)
    const sliver = Math.round(w * 0.05)
    for (let i = 0; i < w * h; i++) {
      const v = i % w < sliver ? 0 : 200
      rgba[i * 4] = v
      rgba[i * 4 + 1] = v
      rgba[i * 4 + 2] = v
      rgba[i * 4 + 3] = 255
    }
    const q = mapToLuminanceBands(rgba, 8, w, h, false)
    const counts = new Uint32Array(8)
    for (const idx of q.indexMap) counts[idx]++
    const minShare = Math.floor((w * h) / 8)
    for (let b = 0; b < 8; b++) {
      expect(counts[b]).toBeGreaterThanOrEqual(minShare - 1)
    }
    // Band tops ascend to the top of the relief and never exceed it.
    expect(q.bandTops).toHaveLength(8)
    expect(q.bandTops[7]).toBe(1)
    for (let b = 1; b < 8; b++) {
      expect(q.bandTops[b]).toBeGreaterThanOrEqual(q.bandTops[b - 1])
    }
  })
})

describe('heightmap (layer-stepped relief)', () => {
  it('turns the relief position into a layer-snapped height', () => {
    const q = quantizedFixture() // indexMap [0,1,2,3], luminance 1 → 0
    const field = buildHeightField(q, settings()) // base 0.8, max 8, layer 0.2
    // HueForge Standard maps brightness continuously to height, so a pixel's
    // column ends between the base plate and the model top — not at its color
    // band's ceiling. darkIsTall flips the relief, so the darkest pixel
    // (index 0) is the tallest one.
    expect(field.values[0]).toBeCloseTo(8, 5)
    expect(field.values[1]).toBeCloseTo(5.6, 5)
    expect(field.values[2]).toBeCloseTo(3.2, 5)
    expect(field.values[3]).toBeCloseTo(0.8, 5)
    // Every height sits on the print's layer grid, which is what gives the
    // stepped tonal transitions of the reference mesh.
    for (const v of field.values) {
      const layers = (v - 0.8) / 0.2
      expect(Math.abs(layers - Math.round(layers))).toBeLessThan(1e-4)
    }
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

/**
 * How many triangles use each edge (keyed by its rounded vertex coords).
 * A closed triangle soup shares every edge between exactly two triangles.
 */
function edgeUses(mesh: Mesh): Map<string, number> {
  const uses = new Map<string, number>()
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
      uses.set(key, (uses.get(key) ?? 0) + 1)
    }
  }
  return uses
}

/** Build a mesh from a per-cell level map (level k sits at base + k·layer). */
function meshFromLevels(levels: number[], width: number, height: number, s = settings()): Mesh {
  const values = new Float32Array(levels.length)
  for (let i = 0; i < levels.length; i++) values[i] = s.baseMm + levels[i] * s.layerMm
  const idx = new Uint8Array(levels.length)
  for (let i = 0; i < levels.length; i++) idx[i] = levels[i] % 4
  return buildMesh({ width, height, values }, idx, PALETTE_4, s)
}

describe('mesh', () => {
  it('is watertight: every edge is shared by exactly two triangles', () => {
    const q = quantizedFixture()
    const field = buildHeightField(q, settings())
    const mesh = buildMesh(field, q.indexMap, q.palette, settings())
    expect(mesh.triangleCount).toBeGreaterThan(0)

    for (const count of edgeUses(mesh).values()) {
      expect(count).toBe(2)
    }
  })

  it('stays closed when heights only touch diagonally (pinches are filled)', () => {
    // Checkerboard of two levels: every interior corner has two tall cells
    // meeting only at a point. Left alone those four wall panels would share
    // one vertical edge; the mesher fills one notch instead.
    const pattern = [
      0, 1, 0, 1,
      1, 0, 1, 0,
      0, 1, 0, 1,
      1, 0, 1, 0,
    ]
    const mesh = meshFromLevels(pattern, 4, 4)
    for (const count of edgeUses(mesh).values()) {
      expect(count).toBe(2)
    }
  })

  it('is a staircase: flat plateaus on the layer grid, strictly vertical walls', () => {
    const q = quantizedFixture()
    const field = buildHeightField(q, settings())
    const mesh = buildMesh(field, q.indexMap, q.palette, settings())
    const p = mesh.positions
    const plateauZ = new Set<number>()
    for (let t = 0; t < mesh.triangleCount; t++) {
      const i = t * 9
      const xs = [p[i], p[i + 3], p[i + 6]]
      const ys = [p[i + 1], p[i + 4], p[i + 7]]
      const zs = [p[i + 2], p[i + 5], p[i + 8]]
      const flatZ = zs[0] === zs[1] && zs[1] === zs[2]
      const flatX = xs[0] === xs[1] && xs[1] === xs[2]
      const flatY = ys[0] === ys[1] && ys[1] === ys[2]
      // Every face is a flat plateau / base quad or a vertical wall panel.
      expect(flatZ || flatX || flatY).toBe(true)
      if (flatZ && zs[0] > 0) plateauZ.add(Math.round(zs[0] * 1e4) / 1e4)
      for (const z of zs) {
        if (z === 0) continue // bed vertex of a border wall
        const layers = (z - 0.8) / 0.2
        expect(Math.abs(layers - Math.round(layers))).toBeLessThan(1e-5)
      }
    }
    // One flat plateau per cell, each at its own column height, and nothing
    // sloped in between (a bilinear relief would not produce this set).
    expect([...plateauZ].sort((a, b) => a - b)).toEqual([0.8, 3.2, 5.6, 8])
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

    // Every cell is a flat plateau at its own layer height, so the volume is
    // Σ cellArea × plateau height (the base plate at z = 0 adds nothing). The
    // mirrored fixture heights are 3.2 / 0.8 / 8 / 5.6 mm.
    const plateaus = [3.2, 0.8, 8, 5.6]
    const expected = plateaus.reduce((sum, z) => sum + 20 * 20 * z, 0)
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
      bandTops: [0.25, 0.5, 0.75, 1],
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

  it('merges flat areas: one plateau rectangle for the whole top surface', () => {
    // 60×40 at a single height and a single filament merges into one top
    // rectangle, four border panels and the base plate — not 2400 quads.
    const W = 60
    const H = 40
    const mesh = meshFromLevels(new Array<number>(W * H).fill(2), W, H)
    expect(mesh.triangleCount).toBeLessThan(64)
    for (const count of edgeUses(mesh).values()) expect(count).toBe(2)
  })

  it('merges wall runs and never costs more than the per-cell quad model', () => {
    // A ramp: one level and one filament per column, so no diagonal pins are
    // filled and the levels stay exactly as given. Merging turns the surface
    // into one rectangle per column and each step into a single wall panel.
    const W = 12
    const H = 8
    const levels: number[] = []
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) levels.push(i)
    const mesh = meshFromLevels(levels, W, H)
    // Previous model: a top and a base quad per cell, plus a quad per strip of
    // every step (the ramp steps once per column, over every row).
    const perCellModel = 4 * W * H + 2 * (H * (W - 1))
    expect(mesh.triangleCount).toBeLessThan(perCellModel / 3)
    for (const count of edgeUses(mesh).values()) expect(count).toBe(2)
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

  it('snaps band tops to the chosen layer-height grid', () => {
    // base 1, max 8.5, 4 colors → ideals 2.875 / 4.75 / 6.625 / 8.5, which are
    // NOT on the 0.15 mm grid; the snapped tops must be grid multiples.
    const q = quantizedFixture()
    const img = { width: 2, height: 2, rgba: new Uint8ClampedArray(2 * 2 * 4).fill(128) }
    const result = finishPipeline(img, q, {
      numColors: 4,
      darkIsTall: false,
      widthMm: 40,
      heightMm: 40,
      baseMm: 1,
      maxHeightMm: 8.5,
      layerMm: 0.15,
    })

    const tops = [...result.palette]
      .sort((a, b) => a.printOrder - b.printOrder)
      .map((p) => p.topZMm)
    // Internal tops are grid-aligned; the final top is clamped to the user's
    // max-height value exactly (8.5, which is NOT a multiple of 0.15).
    expect(tops).toEqual([2.85, 4.8, 6.6, 8.5].map((v) => expect.closeTo(v, 6)))
    for (const z of tops.slice(0, -1)) {
      const grid = z / 0.15
      expect(Math.abs(grid - Math.round(grid))).toBeLessThan(1e-6)
    }
    expect(tops[tops.length - 1]).toBeCloseTo(8.5, 6)
  })

  it('keeps band tops strictly increasing when rounding would collide', () => {
    // 4 bands squeezed into 0.8..1.2 mm: bands (0.1 mm) are thinner than half
    // a 0.2 mm layer, so rounding alone would collide tops (0.9→1.0, 1.0→1.0,
    // 1.1→1.2, 1.2→1.2) — the snap must push them apart instead of emitting
    // duplicate swap layers.
    const q = quantizedFixture()
    const img = { width: 2, height: 2, rgba: new Uint8ClampedArray(2 * 2 * 4).fill(128) }
    const result = finishPipeline(img, q, {
      numColors: 4,
      darkIsTall: false,
      widthMm: 40,
      heightMm: 40,
      baseMm: 0.8,
      maxHeightMm: 1.2,
      layerMm: 0.2,
    })

    const tops = [...result.palette]
      .sort((a, b) => a.printOrder - b.printOrder)
      .map((p) => p.topZMm)
    expect(tops).toHaveLength(4)
    expect(tops).toEqual([1.0, 1.2, 1.4, 1.6].map((v) => expect.closeTo(v, 6)))
    for (let i = 1; i < tops.length; i++) {
      expect(tops[i] - tops[i - 1]).toBeGreaterThanOrEqual(0.2 - 1e-9)
    }
  })

  it('exports tool changes exactly on the grid', () => {
    const q = quantizedFixture()
    const img = { width: 2, height: 2, rgba: new Uint8ClampedArray(2 * 2 * 4).fill(128) }
    const result = finishPipeline(img, q, {
      numColors: 4,
      darkIsTall: true,
      widthMm: 40,
      heightMm: 40,
      baseMm: 0.8,
      maxHeightMm: 8,
      layerMm: 0.2,
    })
    const zip = generate3mf({ mesh: result.mesh, modelName: 'test', bands: result.palette })
    const gcode = strFromU8(unzipSync(zip)['Metadata/custom_gcode_per_layer.xml'])
    const tops = [...gcode.matchAll(/top_z="([\d.]+)"/g)].map((m) => m[1])
    expect(tops).toEqual(['2.6', '4.4', '6.2'])
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

describe('auto-removal of fragile isolated regions', () => {
  it('flattens same-band specks into their surroundings but keeps regions ≥ 3×3', () => {
    const w = 10, h = 10
    const x = new Float32Array(w * h).fill(0.5)
    const labels = new Uint8Array(w * h).fill(0)
    // a 1-px speck of band 3 and a 2×2 speck of band 2
    labels[5 * w + 5] = 3
    x[5 * w + 5] = 0.9
    for (const [dy, dx] of [[1, 1], [1, 2], [2, 1], [2, 2]]) {
      labels[dy * w + dx] = 2
      x[dy * w + dx] = 0.7
    }
    // a 4×4 region (16 ≥ MIN_REGION_CELLS) must survive untouched
    for (let y = 4; y < 8; y++) {
      for (let xx = 0; xx < 4; xx++) {
        labels[y * w + xx] = 1
        x[y * w + xx] = 0.6
      }
    }
    const out = removeIsolatedRegions(x, labels, w, h, MIN_REGION_CELLS)
    expect(out[5 * w + 5]).toBeCloseTo(0.5)   // 1-px speck flattened to ground
    expect(out[1 * w + 1]).toBeCloseTo(0.5)   // 2×2 speck flattened to ground
    expect(out[4 * w + 0]).toBeCloseTo(0.6)   // 4×4 region kept as-is
  })

  it('leaves large regions untouched', () => {
    const w = 8, h = 8
    const x = new Float32Array(w * h).fill(0.4)
    const labels = new Uint8Array(w * h).fill(0)
    for (let y = 0; y < 4; y++) {
      for (let xx = 0; xx < 4; xx++) {
        labels[y * w + xx] = 1
        x[y * w + xx] = 0.8
      }
    }
    const out = removeIsolatedRegions(x, labels, w, h, MIN_REGION_CELLS)
    expect(out[0]).toBeCloseTo(0.8)           // 4×4 = 16 cells, kept
    expect(out[4 * w + 4]).toBeCloseTo(0.4)   // background untouched
  })

  it('merges a boundary-straddling speck into the band it touches most', () => {
    const w = 12, h = 12
    // Band-0 background with a tall band-2 strip at columns 8..9.
    const x = new Float32Array(w * h).fill(0.2)
    const labels = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (const xx of [8, 9]) {
        labels[y * w + xx] = 2
        x[y * w + xx] = 0.9
      }
    }
    // A 2×2 band-1 speck pressed between them: band 0 on the left/top/bottom,
    // band 2 on the right — it straddles the 0/2 boundary without being
    // 4-connected to either mainland region.
    for (const [yy, xx] of [[5, 6], [5, 7], [6, 6], [6, 7]]) {
      labels[yy * w + xx] = 1
      x[yy * w + xx] = 0.55
    }
    const out = removeIsolatedRegions(x, labels, w, h, MIN_REGION_CELLS)

    // The 4-cell speck (size 4 < 9) merges into band 0 — the majority touch —
    // so its cells take band 0's value (0.2), not a blurred mid value.
    expect(out[5 * w + 6]).toBeCloseTo(0.2)
    expect(out[6 * w + 7]).toBeCloseTo(0.2)
    // The band-2 strip (≥ minArea) and the background are untouched.
    expect(out[5 * w + 8]).toBeCloseTo(0.9)
    expect(out[0]).toBeCloseTo(0.2)
  })

  it('iterates cleanup until a noisy gradient has zero specks', () => {
    const w = 48, h = 48
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let xx = 0; xx < w; xx++) {
        const p = (y * w + xx) * 4
        const base = Math.round(255 * ((xx + y) / (w + h - 2)))
        // Deterministic hash noise punches sub-3×3 holes across the gradient.
        const noise = ((xx * 73856093) ^ (y * 19349663)) % 97
        const v = Math.max(0, Math.min(255, base + (noise < 5 ? 140 : noise > 92 ? -140 : 0)))
        rgba[p] = v
        rgba[p + 1] = v
        rgba[p + 2] = v
        rgba[p + 3] = 255
      }
    }
    const q = mapToLuminanceBands(rgba, 6, w, h, false)
    const { specks: remaining } = findIsolatedRegions(q.indexMap, w, h)
    expect(remaining).toBe(0)
  })

  it('removes every speck from a speckled image through the full quantizer', () => {
    const w = 30, h = 30
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = 128
      rgba[i * 4 + 1] = 128
      rgba[i * 4 + 2] = 128
      rgba[i * 4 + 3] = 255
    }
    const specks = [[5, 5], [5, 20], [12, 10], [20, 5], [22, 22], [27, 8], [8, 27]]
    for (const [y, xx] of specks) {
      const p = (y * w + xx) * 4
      const bright = (y + xx) % 2 === 0
      const v = bright ? 255 : 0
      rgba[p] = v
      rgba[p + 1] = v
      rgba[p + 2] = v
    }
    const q = mapToLuminanceBands(rgba, 8, w, h, false)
    const { specks: remaining } = findIsolatedRegions(q.indexMap, w, h)
    expect(remaining).toBe(0)
    // the equal-population guarantee still holds after cleanup
    const counts = new Map<number, number>()
    for (const idx of q.indexMap) counts.set(idx, (counts.get(idx) ?? 0) + 1)
    for (const c of counts.values()) {
      expect(c).toBeGreaterThanOrEqual(Math.floor((w * h) / 8) - 1)
    }
  })
})

describe('custom band heights (HueForge-style per-color thickness)', () => {
  const baseMm = 0.8
  const layerMm = 0.2

  function run(heights: number[] | undefined) {
    return finishPipeline(
      { width: 2, height: 2, rgba: new Uint8ClampedArray(16) },
      quantizedFixture(),
      {
        numColors: 4,
        darkIsTall: true,
        widthMm: 40,
        heightMm: 40,
        baseMm,
        maxHeightMm: 8,
        layerMm,
        bandHeightsMm: heights,
      },
    )
  }

  it('derives the total height from the band sums (base + Σh)', () => {
    const r = run([1.2, 0.9, 0.6, 0.4])
    expect(r.settings.maxHeightMm).toBeCloseTo(baseMm + 3.1, 9)
    expect(r.quantized.bandHeightsMm).toEqual([1.2, 0.9, 0.6, 0.4])
    expect(r.settings.maxHeightMm).toBeCloseTo(
      baseMm + r.quantized.bandHeightsMm!.reduce((a, c) => a + c, 0),
      9,
    )
  })

  it('snaps internal tops to the layer grid and keeps the final top exactly at max height', () => {
    const r = run([1.2, 0.9, 0.6, 0.4])
    const tops = snappedBandTops(r.quantized, r.settings)
    expect(tops[3]).toBeCloseTo(r.settings.maxHeightMm, 9)
    for (let i = 0; i < 3; i++) {
      const grid = tops[i] / layerMm
      expect(Math.abs(grid - Math.round(grid))).toBeLessThan(1e-9)
      expect(tops[i]).toBeGreaterThan(baseMm)
      expect(tops[i]).toBeLessThan(tops[i + 1])
    }
  })

  it('keeps every pixel inside its own band’s slice, on the layer grid', () => {
    const r = run([1.2, 0.9, 0.6, 0.4])
    const tops = snappedBandTops(r.quantized, r.settings)
    const bandTops = r.quantized.bandTops
    // indexMap [0,1,2,3] with darkIsTall → pixel i owns slice 3-i. Custom
    // thicknesses move the slices' physical heights but must not let a pixel's
    // surface leave its own color band.
    const values = Array.from(r.field.values)
    values.forEach((z, i) => {
      const slice = 3 - i
      const loZ = slice === 0 ? baseMm : tops[slice - 1]
      expect(z).toBeGreaterThanOrEqual(loZ - 1e-5)
      expect(z).toBeLessThanOrEqual(tops[slice] + 1e-5)
      // Heights sit on the print's layer grid. The model top is the sole
      // exception: it is clamped to the configured total, which need not be a
      // whole number of layers (the mesher steps it back onto the grid).
      if (z < r.settings.maxHeightMm - 1e-6) {
        const layers = (z - baseMm) / layerMm
        expect(Math.abs(layers - Math.round(layers))).toBeLessThan(1e-4)
      }
      // The luminance stays inside the band the pixel's color was assigned
      // from — colors and heights cannot disagree.
      expect(r.quantized.luminance[i]).toBeGreaterThanOrEqual(slice === 0 ? 0 : bandTops[slice - 1])
      expect(r.quantized.luminance[i]).toBeLessThanOrEqual(bandTops[slice])
    })
    expect(values[0]).toBeCloseTo(r.settings.maxHeightMm, 5)
  })

  it('reports custom thicknesses through the palette entries (print order)', () => {
    const r = run([1.2, 0.9, 0.6, 0.4])
    const byOrder = new Map(r.palette.map((p) => [p.printOrder, p.topZMm]))
    // darkIsTall → darkest palette idx (0) prints last (order 4); the lightest
    // (idx 3, thickness 0.4) prints first: its top is base + 0.4 exactly, and
    // the darkest band's top is the derived max height.
    expect(byOrder.get(1)).toBeCloseTo(baseMm + 0.4, 9)
    expect(byOrder.get(4)).toBeCloseTo(r.settings.maxHeightMm, 9)
  })

  it('falls back to equal bands when no custom heights are given', () => {
    const r = run(undefined)
    expect(r.settings.maxHeightMm).toBe(8)
    expect(r.quantized.bandHeightsMm).toBeUndefined()
  })

  it('scales heights down when the sum would exceed the 40 mm ceiling', () => {
    const r = run([10, 10, 10, 10])
    expect(r.settings.maxHeightMm).toBeLessThanOrEqual(40)
    expect(r.settings.maxHeightMm).toBeCloseTo(
      baseMm + r.quantized.bandHeightsMm!.reduce((a, c) => a + c, 0),
      9,
    )
    expect(r.settings.maxHeightMm).toBeGreaterThan(baseMm)
  })
})
