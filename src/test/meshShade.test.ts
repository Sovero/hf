import { describe, expect, it } from 'vitest'
import { buildMesh, shadeTopSurface } from '../lib/mesh'
import type { PrintSettings } from '../lib/types'

describe('shadeTopSurface', () => {
  const settings: PrintSettings = { widthMm: 3, heightMm: 2, baseMm: 0.48, maxHeightMm: 2.24, darkIsTall: false, layerMm: 0.08 }
  const W = 3
  const H = 2
  const field = { width: W, height: H, values: new Float32Array([0.6, 1.0, 1.4, 0.8, 1.2, 2.2]) }
  const mesh = buildMesh(field, new Uint8Array([0, 1, 2, 0, 1, 2]), [
    { r: 0, g: 0, b: 0 },
    { r: 128, g: 128, b: 128 },
    { r: 255, g: 255, b: 255 },
  ], settings)

  it('paints each top cell with its own pixel, rows mirrored like the mesh', () => {
    const rgba = new Uint8ClampedArray(W * H * 4)
    for (let i = 0; i < W * H; i++) rgba.set([10 * i, 20 * i, 30 * i, 255], i * 4)
    const colors = shadeTopSurface(mesh, rgba, W, H)
    expect(colors).not.toBe(mesh.colors)
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const cellIndex = (H - 1 - r) * W + c // row 0 of the picture is the far edge
        const pixel = r * W + c
        for (let v = 0; v < 6; v++) {
          const o = cellIndex * 18 + v * 3
          expect(colors[o]).toBeCloseTo((10 * pixel) / 255, 5)
          expect(colors[o + 1]).toBeCloseTo((20 * pixel) / 255, 5)
          expect(colors[o + 2]).toBeCloseTo((30 * pixel) / 255, 5)
        }
      }
    }
  })

  it('leaves the walls and the base in their filament colors', () => {
    const rgba = new Uint8ClampedArray(W * H * 4).fill(77)
    const colors = shadeTopSurface(mesh, rgba, W, H)
    const top = 2 * W * H * 9
    expect(Array.from(colors.subarray(top))).toEqual(Array.from(mesh.colors.subarray(top)))
  })
})
