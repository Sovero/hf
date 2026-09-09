import { beforeEach, describe, expect, it } from 'vitest'
import { resetWorkerState, runWorkerTask, type QuantizeTask } from '../lib/workerProtocol'
import type { RGB } from '../lib/types'

const C = (r: number, g: number, b: number): RGB => ({ r, g, b })

/** 2×2 image: two dark pixels, two light ones (a hard vertical split). */
function twoBandImage(): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(4 * 2 * 2)
  const put = (i: number, r: number, g: number, b: number) => {
    rgba[i * 4] = r
    rgba[i * 4 + 1] = g
    rgba[i * 4 + 2] = b
    rgba[i * 4 + 3] = 255
  }
  put(0, 40, 40, 40)
  put(1, 45, 45, 45)
  put(2, 220, 220, 220)
  put(3, 225, 225, 225)
  return rgba
}

function task(overrides: Partial<QuantizeTask> = {}): QuantizeTask {
  return {
    type: 'quantize',
    id: 1,
    rgba: twoBandImage(),
    width: 2,
    height: 2,
    opts: {
      numColors: 4,
      darkIsTall: false,
      widthMm: 40,
      heightMm: 40,
      baseMm: 0.8,
      maxHeightMm: 10,
      layerMm: 0.2,
    },
    ...overrides,
  }
}

beforeEach(() => resetWorkerState())

describe('mergeDeltaE in the worker protocol', () => {
  it('default: no merge, palette keeps the requested count', () => {
    const r = runWorkerTask(task())
    expect(r.quantized.palette.length).toBe(4)
  })

  it('huge threshold collapses everything into one band', () => {
    const r = runWorkerTask(task({ mergeDeltaE: 200 }))
    expect(r.quantized.palette.length).toBe(1)
    expect(Array.from(r.quantized.indexMap)).toEqual([0, 0, 0, 0])
  })

  it('mid threshold merges near-duplicates but keeps distinct bands', () => {
    const r = runWorkerTask(task({ mergeDeltaE: 8 }))
    const n = r.quantized.palette.length
    // The two dark (40/45) and two light (220/225) pairs are near-identical;
    // the dark↔light gap is huge. Expect 2 survivors.
    expect(n).toBe(2)
    const labels = new Set(Array.from(r.quantized.indexMap))
    expect(labels.size).toBe(n)
  })

  it('keeps band tops strictly increasing after a merge', () => {
    const r = runWorkerTask(task({ mergeDeltaE: 8 }))
    const tops = r.quantized.bandTops
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(tops[i - 1])
    expect(tops[tops.length - 1]).toBe(1)
  })

  it('sums custom band thicknesses of merged groups', () => {
    const r = runWorkerTask(
      task({
        mergeDeltaE: 8,
        opts: {
          numColors: 4,
          darkIsTall: false,
          widthMm: 40,
          heightMm: 40,
          baseMm: 0.8,
          maxHeightMm: 10,
          layerMm: 0.2,
          bandHeightsMm: [1, 2, 3, 4],
        },
      }),
    )
    // Two groups: (1+2) and (3+4).
    expect(r.quantized.bandHeightsMm).toEqual([3, 7])
  })

  it('merges the catalog (nearest-palette) path too', () => {
    const spools = [C(40, 40, 40), C(44, 44, 44), C(220, 220, 220), C(226, 226, 226)]
    const r = runWorkerTask(
      task({
        mergeDeltaE: 8,
        nearestPalette: true,
        paletteOverride: spools,
      }),
    )
    expect(r.quantized.palette.length).toBe(2)
    expect(r.quantized.palette[0]).toEqual(C(40, 40, 40))
    expect(r.quantized.palette[1]).toEqual(C(220, 220, 220))
  })

  it('survivor keeps its own filament color (no averaging)', () => {
    const r = runWorkerTask(task({ mergeDeltaE: 8 }))
    const colors = r.quantized.palette.map((c) => `${c.r},${c.g},${c.b}`)
    expect(colors).toContain('40,40,40')
    expect(colors).toContain('220,220,220')
  })
})
