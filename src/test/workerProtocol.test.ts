import { beforeEach, describe, expect, it } from 'vitest'
import { runWorkerTask, resetWorkerState, type FinishTask, type QuantizeTask } from '../lib/workerProtocol'
import type { PipelineOptions } from '../lib/pipeline'

/** 8×8 horizontal gray ramp: column x has brightness x/7. */
function ramp(w = 8, h = 8): { rgba: Uint8ClampedArray; width: number; height: number } {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round((x / (w - 1)) * 255)
      const i = (y * w + x) * 4
      rgba[i] = v
      rgba[i + 1] = v
      rgba[i + 2] = v
      rgba[i + 3] = 255
    }
  }
  return { rgba, width: w, height: h }
}

function opts(overrides: Partial<PipelineOptions> = {}): PipelineOptions {
  return {
    numColors: 4,
    darkIsTall: true,
    widthMm: 40,
    heightMm: 40,
    baseMm: 0.8,
    maxHeightMm: 8,
    layerMm: 0.2,
    ...overrides,
  }
}

function quantizeTask(overrides: Partial<QuantizeTask> = {}): QuantizeTask {
  const img = ramp()
  return {
    type: 'quantize',
    id: 1,
    rgba: img.rgba,
    width: img.width,
    height: img.height,
    opts: opts(),
    ...overrides,
  }
}

function finishTask(overrides: Partial<FinishTask> = {}): FinishTask {
  return {
    type: 'finish',
    id: 2,
    opts: opts(),
    palette: [
      { r: 0, g: 0, b: 0 },
      { r: 85, g: 85, b: 85 },
      { r: 170, g: 170, b: 170 },
      { r: 255, g: 255, b: 255 },
    ],
    ...overrides,
  }
}

beforeEach(() => resetWorkerState())

describe('worker pipeline protocol', () => {
  it('quantizes and builds geometry from raw RGBA', () => {
    const r = runWorkerTask(quantizeTask())
    expect(r.quantized.palette).toHaveLength(4)
    expect(r.palette).toHaveLength(4)
    expect(r.field.values.length).toBe(64)
    expect(r.mesh.triangleCount).toBeGreaterThan(0)
    expect(r.settings.maxHeightMm).toBe(8)
    expect(r.darkIsTall).toBe(true)
  })

  it('stamps custom band heights and derives the total height', () => {
    const r = runWorkerTask(quantizeTask({ opts: opts({ bandHeightsMm: [1.2, 0.9, 0.6, 0.4] }) }))
    expect(r.quantized.bandHeightsMm).toEqual([1.2, 0.9, 0.6, 0.4])
    expect(r.settings.maxHeightMm).toBeCloseTo(0.8 + 3.1, 9)
  })

  it('rebuilds geometry from the stored image with a palette override', () => {
    runWorkerTask(quantizeTask())
    const r = runWorkerTask(
      finishTask({
        palette: [
          { r: 255, g: 0, b: 0 },
          { r: 85, g: 85, b: 85 },
          { r: 170, g: 170, b: 170 },
          { r: 255, g: 255, b: 255 },
        ],
      }),
    )
    expect(r.palette[0].color).toEqual({ r: 255, g: 0, b: 0 })
    expect(r.quantized.palette[0]).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('applies reference overrides during quantize (palette + band tops)', () => {
    const plain = runWorkerTask(quantizeTask())
    const overridden = runWorkerTask(
      quantizeTask({
        id: 3,
        paletteOverride: [
          { r: 10, g: 10, b: 10 },
          { r: 20, g: 20, b: 20 },
          { r: 30, g: 30, b: 30 },
          { r: 40, g: 40, b: 40 },
        ],
        bandTopsOverride: [0.2, 0.5, 0.8, 1],
      }),
    )
    expect(overridden.quantized.palette[0]).toEqual({ r: 10, g: 10, b: 10 })
    expect(overridden.quantized.bandTops).toEqual([0.2, 0.5, 0.8, 1])
    expect(overridden.palette.map((p) => p.topZMm)).not.toEqual(plain.palette.map((p) => p.topZMm))
  })

  it('keeps worker state intact when response buffers are transferred away', () => {
    // The response arrays are fresh copies: mutating them must not corrupt
    // the worker-side quantized image used by the next finish request.
    const first = runWorkerTask(quantizeTask())
    first.quantized.indexMap.fill(0)
    first.field.values.fill(0)
    const r = runWorkerTask(finishTask())
    expect(r.field.values.some((v) => v > 0)).toBe(true)
    expect(r.mesh.triangleCount).toBeGreaterThan(0)
  })

  it('rejects a finish request before any quantize ran', () => {
    expect(() => runWorkerTask(finishTask())).toThrow(/No image processed/)
  })

  it('replaces the stored image on a second quantize', () => {
    const small = ramp(4, 4)
    runWorkerTask(quantizeTask())
    const r = runWorkerTask(
      quantizeTask({ id: 4, rgba: small.rgba, width: 4, height: 4, opts: opts({ numColors: 2 }) }),
    )
    expect(r.quantized.palette).toHaveLength(2)
    expect(r.field.values.length).toBe(16)
    const again = runWorkerTask(finishTask({ id: 5, opts: opts({ numColors: 2 }) }))
    expect(again.quantized.palette).toHaveLength(2)
  })
})