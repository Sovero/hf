import { describe, expect, it } from 'vitest'
import { compareRelief, measureRelief, parseStl, StlParseError, type ReliefMetrics } from '../lib/reliefCompare'
import { exportStl, finishPipeline } from '../lib/pipeline'
import { MAX_REFERENCE_FILE_BYTES } from '../lib/reference3mf'
import type { QuantizedImage, RGB } from '../lib/types'

const PALETTE: RGB[] = [
  { r: 0, g: 0, b: 0 },
  { r: 85, g: 85, b: 85 },
  { r: 170, g: 170, b: 170 },
  { r: 255, g: 255, b: 255 },
]

/**
 * A relief whose rows hold a dark→light gradient. `rows` rows over 8 columns:
 * a coarse gradient jumps a whole band per row, a dense one lands on almost
 * every print layer.
 */
function quantized(rows: number, cols = 8): QuantizedImage {
  const indexMap = new Uint8Array(cols * rows)
  const luminance = new Float32Array(cols * rows)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      indexMap[y * cols + x] = Math.min(PALETTE.length - 1, Math.floor((y / rows) * PALETTE.length))
      luminance[y * cols + x] = 1 - y / (rows - 1)
    }
  }
  return { palette: PALETTE, indexMap, luminance, bandTops: [0.25, 0.5, 0.75, 1], width: cols, height: rows }
}

function ourResult(rows = 4, cols = 8) {
  const image = { width: cols, height: rows, rgba: new Uint8ClampedArray(cols * rows * 4).fill(128) }
  return finishPipeline(image, quantized(rows, cols), {
    numColors: 4,
    darkIsTall: true,
    widthMm: 40,
    heightMm: 20,
    baseMm: 0.8,
    maxHeightMm: 8,
    layerMm: 0.2,
  })
}

/**
 * A triangle soup with the requested face count and orientation, so the metric
 * definitions (plateau / slant / wall shares, pitch, levels) are pinned
 * independently of the mesher.
 */
function quad(a: number[], b: number[], c: number[], d: number[]): number[] {
  return [...a, ...b, ...c, ...a, ...c, ...d]
}

function metricsOf(tris: number[], known?: { gridStepX?: number; gridStepY?: number }): ReliefMetrics {
  return measureRelief(Float32Array.from(tris), tris.length / 9, known)
}

describe('parseStl', () => {
  it('reads the app’s own binary export back triangle for triangle', () => {
    const result = ourResult()
    const bytes = new Uint8Array(exportStl(result))
    const mesh = parseStl({ fileName: 'ours.stl', data: bytes })

    expect(mesh.format).toBe('binary')
    expect(mesh.truncated).toBe(false)
    expect(mesh.triangleCount).toBe(result.mesh.triangleCount)
    expect(bytes.byteLength).toBe(84 + 50 * result.mesh.triangleCount)
  })

  it('keeps the same measurements through a binary round trip', () => {
    const result = ourResult()
    const known = {
      gridStepX: result.settings.widthMm / result.field.width,
      gridStepY: result.settings.heightMm / result.field.height,
    }
    const original = measureRelief(result.mesh.positions, result.mesh.triangleCount, known)
    const mesh = parseStl({ fileName: 'ours.stl', data: new Uint8Array(exportStl(result)) })
    const roundTripped = measureRelief(mesh.positions, mesh.triangleCount, known)

    expect(roundTripped.sizeX).toBeCloseTo(original.sizeX, 4)
    expect(roundTripped.sizeY).toBeCloseTo(original.sizeY, 4)
    expect(roundTripped.sizeZ).toBeCloseTo(original.sizeZ, 4)
    expect(roundTripped.levelCount).toBe(original.levelCount)
    expect(roundTripped.heightStep).toBeCloseTo(original.heightStep, 4)
    expect(roundTripped.topShare).toBeCloseTo(original.topShare, 6)
  })

  it('flags a truncated binary file and reads the complete triangles it has', () => {
    const result = ourResult()
    const full = new Uint8Array(exportStl(result))
    const kept = 3
    const cut = full.slice(0, 84 + 50 * kept)
    const mesh = parseStl({ fileName: 'partial.stl', data: cut })

    expect(mesh.truncated).toBe(true)
    expect(mesh.triangleCount).toBe(kept)
    expect(mesh.positions.length).toBe(kept * 9)
  })

  it('parses an ASCII STL and a “solid”-headed binary STL', () => {
    const ascii = new TextEncoder().encode(
      'solid ref\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid ref\n',
    )
    const asciiMesh = parseStl({ fileName: 'ref.stl', data: ascii })
    expect(asciiMesh.format).toBe('ascii')
    expect(asciiMesh.triangleCount).toBe(1)

    // A binary file is allowed to start with "solid": it must not be rejected
    // just because the text scan finds no vertices.
    const binary = new Uint8Array(exportStl(ourResult()))
    binary.set(new TextEncoder().encode('solid bin'), 0)
    const binaryMesh = parseStl({ fileName: 'bin.stl', data: binary })
    expect(binaryMesh.format).toBe('binary')
    expect(binaryMesh.triangleCount).toBe(ourResult().mesh.triangleCount)
  })

  it('rejects a wrong extension, an empty file, an oversized file and garbage', () => {
    const name = (fileName: string) => ({ fileName, data: new Uint8Array([1, 2, 3, 4]) })
    expect(() => parseStl(name('reference.3mf'))).toThrow(StlParseError)
    expect(() => parseStl(name('reference.3mf'))).toThrow(/\.stl/)

    const empty = () => parseStl({ fileName: 'a.stl', data: new Uint8Array(0) })
    expect(empty).toThrow(StlParseError)
    expect(empty).toThrow(/empty/i)

    const digits = (code: StlParseError['code'] | undefined, fn: () => unknown) => {
      try {
        fn()
      } catch (err) {
        expect(err).toBeInstanceOf(StlParseError)
        expect((err as StlParseError).code).toBe(code)
        return
      }
      throw new Error('expected a StlParseError')
    }
    digits('extension', () => parseStl({ fileName: 'x.obj', data: new Uint8Array(4) }))
    digits('size', () => parseStl({ fileName: 'x.stl', data: new Uint8Array(0) }))
    digits('size', () => parseStl({ fileName: 'x.stl', data: new Uint8Array(MAX_REFERENCE_FILE_BYTES + 1) }))
    digits('format', () => parseStl({ fileName: 'x.stl', data: new Uint8Array(10) }))
    digits('format', () => parseStl({ fileName: 'x.stl', data: new Uint8Array(200) }))

    // No name at all means "unknown", not "wrong".
    expect(() => parseStl({ fileName: '', data: new Uint8Array(10) })).toThrow(/readable STL/)
  })
})

describe('measureRelief', () => {
  it('reads the cell pitch, the layer step and the level count off the triangles', () => {
    // A 3×1 ribbon of plateaus at 1 mm and 2 mm: cells are 1 mm wide, levels
    // are 1 mm apart, and the top surface exists at two heights.
    const tris = [
      ...quad([0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]),
      ...quad([1, 0, 2], [2, 0, 2], [2, 1, 2], [1, 1, 2]),
      ...quad([2, 0, 1], [3, 0, 1], [3, 1, 1], [2, 1, 1]),
    ]
    const m = metricsOf(tris)

    expect(m.gridStepX).toBe(1)
    expect(m.gridStepY).toBeCloseTo(1, 6)
    expect(m.heightStep).toBe(1)
    expect(m.levelCount).toBe(2)
    expect(m.plateauZMin).toBe(1)
    expect(m.plateauZMax).toBe(2)
    expect(m.sizeX).toBe(3)
    expect(m.sizeZ).toBe(1)
    expect(m.topShare).toBe(1)
    expect(m.slantShare).toBe(0)
    expect(m.wallShare).toBe(0)
  })

  it('separates slanted transitions from vertical walls, ignoring the base plate', () => {
    const wall = quad([0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0])
    const slant = quad([0, 0, 1], [1, 0, 1], [1, 1, 2], [0, 1, 2])
    const top = quad([1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0])
    // Winding decides which way a face looks: the same square, wound the other
    // way, is the base plate.
    const floor = quad([0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0])

    expect(metricsOf(wall).wallShare).toBe(1)
    expect(metricsOf(slant).slantShare).toBe(1)
    expect(metricsOf(top).topShare).toBe(1)
    // The downward-facing base plate counts toward neither: with only the floor
    // present there is no visible surface at all.
    const floorOnly = metricsOf(floor)
    expect(floorOnly.topShare).toBe(0)
    expect(floorOnly.wallShare).toBe(0)
    expect(floorOnly.slantShare).toBe(0)
  })

  it('takes the pitch from the caller when the mesh has been merged', () => {
    const merged = metricsOf(quad([0, 0, 1], [40, 0, 1], [40, 20, 1], [0, 20, 1]))
    expect(merged.gridStepX).toBe(40) // one big rectangle: nothing to infer from
    const known = measureRelief(
      Float32Array.from(quad([0, 0, 1], [40, 0, 1], [40, 20, 1], [0, 20, 1])),
      2,
      { gridStepX: 0.4, gridStepY: 0.4 },
    )
    expect(known.gridStepX).toBe(0.4)
    expect(known.gridStepY).toBe(0.4)
  })

  it('our relief is a height map: sloped transitions, walls only on the contour', () => {
    // A 32×32 grid over 40×40 mm: square cells, so the contour's share of the
    // surface is representative, and a gradient dense enough that almost every
    // print layer is used.
    const result = ourResult(32, 32)
    const m = measureRelief(result.mesh.positions, result.mesh.triangleCount, {
      gridStepX: result.settings.widthMm / result.field.width,
      gridStepY: result.settings.heightMm / result.field.height,
    })

    expect(m.topShare + m.wallShare + m.slantShare).toBeCloseTo(1, 6)
    // A tonal ramp prints as slanted faces — that is the whole point of the
    // shared vertex grid (the stepped model had none at all).
    expect(m.slantShare).toBeGreaterThan(0.3)
    expect(m.wallShare).toBeGreaterThan(0)
    // Vertical faces are the outer contour and nothing else: four wall quads
    // per contour cell, whatever the picture does inside (the share of the
    // surface they take depends on the model's height vs its footprint, so the
    // count — not the share — is what pins the model here).
    const mesh = result.mesh
    const p = mesh.positions
    let vertical = 0
    for (let t = 0; t < mesh.triangleCount; t++) {
      const i = t * 9
      const xs = [p[i], p[i + 3], p[i + 6]]
      const ys = [p[i + 1], p[i + 4], p[i + 7]]
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1]
      const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1]
      const nz = ux * vy - uy * vx
      if (Math.abs(nz) > 1e-9) continue
      vertical++
      const onX = Math.min(...xs) === Math.max(...xs)
      const onContour = onX
        ? xs[0] === 0 || xs[0] === result.settings.widthMm
        : ys[0] === 0 || ys[0] === result.settings.heightMm
      expect(onContour).toBe(true)
    }
    expect(vertical).toBe(4 * (32 + 32))
    expect(m.gridStepX).toBeCloseTo(result.settings.widthMm / 32, 6)
    expect(m.gridStepY).toBeCloseTo(result.settings.heightMm / 32, 6)
    expect(m.heightStep).toBeCloseTo(0.2, 6) // the layer height, by construction
    expect(m.levelCount).toBeGreaterThan(20)
  })

  it('handles an empty triangle set without producing NaN', () => {
    const m = measureRelief(new Float32Array(0), 0)
    expect(m.sizeX).toBe(0)
    expect(m.sizeZ).toBe(0)
    expect(m.levelCount).toBe(0)
    expect(m.topShare).toBe(0)
    expect(Number.isNaN(m.gridStepX)).toBe(false)
  })
})

describe('compareRelief', () => {
  const base = (overrides: Partial<ReliefMetrics> = {}): ReliefMetrics => ({
    triangleCount: 100,
    sizeX: 200,
    sizeY: 113.6,
    sizeZ: 2.16,
    gridStepX: 0.2,
    gridStepY: 0.2,
    heightStep: 0.08,
    levelCount: 14,
    plateauZMin: 0.8,
    plateauZMax: 2.16,
    topShare: 0.278,
    slantShare: 0.282,
    wallShare: 0.008,
    // Bottom-heavy tonal distribution: the reference started life as a dark
    // picture, so most of its surface area sits in the lower half.
    heightProfile: [0.12, 0.14, 0.13, 0.11, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.03, 0.02, 0.02, 0.01, 0.0],
    ...overrides,
  })

  const status = (comparison: ReturnType<typeof compareRelief>, key: string) =>
    comparison.rows.find((r) => r.key === key)?.status

  it('reports no divergences for identical reliefs', () => {
    const comparison = compareRelief(base(), base())
    expect(comparison.diverging).toBe(0)
    expect(comparison.rows.every((r) => r.status !== 'off')).toBe(true)
    // Triangles are informational — a different count is not a mismatch.
    expect(status(comparison, 'rcRowTriangles')).toBe('info')
  })

  it('accepts a rotated footprint but flags a different one', () => {
    const rotated = compareRelief(base(), base({ sizeX: 113.6, sizeY: 200 }))
    expect(status(rotated, 'rcRowFootprint')).toBe('ok')

    const stretched = compareRelief(base(), base({ sizeX: 200, sizeY: 80 }))
    expect(status(stretched, 'rcRowFootprint')).toBe('off')
  })

  it('flags a coarse height step, too few levels and a missing slant mix', () => {
    // The old flat-plateau model: one step per colour, plateaus only.
    const flat = base({ heightStep: 0.6, levelCount: 4, topShare: 0.9, slantShare: 0, wallShare: 0.1 })
    const comparison = compareRelief(base(), flat)

    expect(status(comparison, 'rcRowHeightStep')).toBe('off')
    expect(status(comparison, 'rcRowLevels')).toBe('off')
    expect(status(comparison, 'rcRowSlants')).toBe('off')
    expect(status(comparison, 'rcRowPlateaus')).toBe('off')
    expect(comparison.diverging).toBeGreaterThanOrEqual(4)
  })

  it('tolerates small differences and formats the deltas', () => {
    const close = compareRelief(base(), base({ sizeZ: 2.2, levelCount: 15, heightStep: 0.1 }))
    expect(status(close, 'rcRowHeight')).toBe('close')
    expect(status(close, 'rcRowLevels')).toBe('close')
    expect(status(close, 'rcRowHeightStep')).toBe('close')

    const height = close.rows.find((r) => r.key === 'rcRowHeight')
    expect(height?.refText).toBe('2.16')
    expect(height?.deltaText.startsWith('+')).toBe(true)
  })

  it('flags a divergent cell pitch and reports the ratio', () => {
    const comparison = compareRelief(base(), base({ gridStepX: 0.571, gridStepY: 0.571 }))
    const row = comparison.rows.find((r) => r.key === 'rcRowGrid')
    expect(row?.status).toBe('off')
    expect(row?.deltaText).toBe('185.5%')
  })
})
