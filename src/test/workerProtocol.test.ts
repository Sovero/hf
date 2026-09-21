import { beforeEach, describe, expect, it } from 'vitest'
import { runWorkerTask, resetWorkerState, type FinishTask, type QuantizeTask } from '../lib/workerProtocol'
import { quantizeToPalette } from '../lib/quantize'
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

  it('quantizes to the nearest catalog spool colors (nearestPalette)', () => {
    // Left half pure red, right half pure blue — with spools [dark gray, blue,
    // red, white] sorted dark → light the pixels must land on red/blue slots.
    const w = 8
    const h = 4
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (x < 4) {
          rgba[i] = 200
          rgba[i + 1] = 20
          rgba[i + 2] = 20
        } else {
          rgba[i] = 20
          rgba[i + 1] = 40
          rgba[i + 2] = 200
        }
        rgba[i + 3] = 255
      }
    }
    const spools = [
      { r: 30, g: 30, b: 30 },
      { r: 25, g: 60, b: 190 },
      { r: 200, g: 25, b: 25 },
      { r: 245, g: 245, b: 245 },
    ]
    const r = runWorkerTask(
      quantizeTask({ id: 9, rgba, width: w, height: h, opts: opts({ numColors: 4 }), paletteOverride: spools, nearestPalette: true }),
    )
    // Palette is exactly the spool set.
    expect(r.quantized.palette).toEqual(spools)
    // Red pixels → spool index 2, blue pixels → spool index 1.
    const idx = (x: number, y: number) => r.quantized.indexMap[y * w + x]
    for (let y = 0; y < h; y++) {
      expect(idx(0, y)).toBe(2)
      expect(idx(7, y)).toBe(1)
    }
    // Equal-thickness bands.
    expect(r.quantized.bandTops).toEqual([0.25, 0.5, 0.75, 1])
    expect(r.palette.map((p) => p.color)).toEqual(spools)
  })

  it('cleans tiny same-color speckles before judging printability', () => {
    const w = 9
    const h = 9
    const rgba = new Uint8ClampedArray(w * h * 4)
    const bg = { r: 250, g: 250, b: 250 }
    const dot = { r: 10, g: 10, b: 10 }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = x === 4 && y === 4 ? dot : bg
        const i = (y * w + x) * 4
        rgba[i] = c.r
        rgba[i + 1] = c.g
        rgba[i + 2] = c.b
        rgba[i + 3] = 255
      }
    }
    const q = quantizeToPalette(rgba, [dot, bg], w, h, 0)
    // The single dark pixel must be merged into the white majority.
    expect(q.indexMap.every((l) => l === 1)).toBe(true)
    expect(q.cleanIndexMap).toBeUndefined()
  })

  it('keeps the pre-dither labels as cleanIndexMap when dithering runs', () => {
    const w = 8
    const h = 8
    const rgba = new Uint8ClampedArray(w * h * 4)
    // Left white, right black with a soft ramp in between.
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
    const spools = [
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
    ]
    const clean = quantizeToPalette(rgba, spools, w, h, 0)
    const dithered = quantizeToPalette(rgba, spools, w, h, 1)
    expect(dithered.cleanIndexMap).toBeDefined()
    // Dithering should break the hard step into a blended boundary: some
    // pixels flip relative to the clean map, but both labels stay present.
    let changed = 0
    for (let i = 0; i < clean.indexMap.length; i++) {
      if (clean.indexMap[i] !== dithered.indexMap[i]) changed++
    }
    expect(changed).toBeGreaterThan(0)
    expect(new Set(Array.from(dithered.indexMap)).size).toBe(2)
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

describe('relief smoothing (opts.smooth)', () => {
  /** Noisy mid-gray image: per-pixel spikes the smoothing must calm. */
  function noisyImage(w: number, h: number): Uint8ClampedArray {
    const a = new Uint8ClampedArray(w * h * 4)
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 80
    for (let i = 0; i < w * h; i++) {
      const v = Math.round(128 + rnd())
      a.set([v, v, v, 255], i * 4)
    }
    return a
  }

  it('smooth=0 output is byte-identical to omitting the field', () => {
    resetWorkerState()
    const rgba = noisyImage(32, 32)
    const off = runWorkerTask(quantizeTask({ id: 11, rgba: rgba.slice(), width: 32, height: 32, opts: opts({ smooth: 0 }) }))
    resetWorkerState()
    const missing = runWorkerTask(quantizeTask({ id: 12, rgba: rgba.slice(), width: 32, height: 32, opts: opts({}) }))
    expect(Array.from(off.quantized.indexMap)).toEqual(Array.from(missing.quantized.indexMap))
    expect(Array.from(off.quantized.luminance)).toEqual(Array.from(missing.quantized.luminance))
    expect(off.quantized.palette).toEqual(missing.quantized.palette)
  })

  it('smooth>0 calms the RGBA source and reshapes a noisy palette', () => {
    resetWorkerState()
    const rgba = noisyImage(32, 32)
    const raw = runWorkerTask(quantizeTask({ id: 13, rgba: rgba.slice(), width: 32, height: 32, opts: opts({}) }))
    resetWorkerState()
    const smoothed = runWorkerTask(quantizeTask({ id: 14, rgba: rgba.slice(), width: 32, height: 32, opts: opts({ smooth: 0.6 }) }))
    // The RGBA pass flattened the noise before quantization, so the palette
    // the noisy picture gets differs from the raw run's palette.
    expect(smoothed.quantized.palette).not.toEqual(raw.quantized.palette)
  })
})