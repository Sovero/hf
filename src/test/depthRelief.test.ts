import { beforeEach, describe, expect, it } from 'vitest'
import { mapToLuminanceBands } from '../lib/quantize'
import { measureRelief, type ReliefMetrics } from '../lib/reliefCompare'
import { resetWorkerState, runFitToneTask, runWorkerTask, type FinishTask, type QuantizeTask } from '../lib/workerProtocol'
import type { PipelineOptions } from '../lib/pipeline'

const W = 16
const H = 16

/** Left half one color, right half another. */
function halves(left: [number, number, number], right: [number, number, number]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = x < W / 2 ? left : right
      rgba.set([c[0], c[1], c[2], 255], (y * W + x) * 4)
    }
  }
  return rgba
}

/** Relief that rises from left (0) to right (1). */
function rampField(): Float32Array {
  const f = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = x / (W - 1)
  return f
}

const YELLOW: [number, number, number] = [240, 240, 60]
const NAVY: [number, number, number] = [20, 20, 80]

describe('mapToLuminanceBands with a depth relief field', () => {
  it('slices the height by the field, not by brightness', () => {
    const q = mapToLuminanceBands(halves(YELLOW, NAVY), 2, W, H, false, 0, undefined, undefined, 0, rampField())
    // Left = low slice (0), right = high slice (1) — although navy is the dark one.
    expect(q.indexMap[0]).toBe(0)
    expect(q.indexMap[W - 1]).toBe(1)
    expect(q.luminance[0]!).toBeLessThan(q.luminance[W - 1]!)
  })

  it('takes each band color from the picture pixels inside that slice', () => {
    const q = mapToLuminanceBands(halves(YELLOW, NAVY), 2, W, H, false, 0, undefined, undefined, 0, rampField())
    // Palette index = height slice, so index 0 is the bright yellow half: NOT sorted dark → light.
    expect(q.palette[0]).toEqual({ r: 240, g: 240, b: 60 })
    expect(q.palette[1]).toEqual({ r: 20, g: 20, b: 80 })
  })

  it('keeps the brightness relief unchanged when no field is given', () => {
    const q = mapToLuminanceBands(halves(YELLOW, NAVY), 2, W, H, false)
    // Brightness model: the dark half is the low slice and palette[0] is the darker color.
    expect(q.palette[0]!.b).toBe(80)
    expect(q.palette[1]!.r).toBe(240)
  })

  it('ignores darkIsTall — the field already says which end is tall', () => {
    const a = mapToLuminanceBands(halves(YELLOW, NAVY), 3, W, H, true, 0, undefined, undefined, 0, rampField())
    const b = mapToLuminanceBands(halves(YELLOW, NAVY), 3, W, H, false, 0, undefined, undefined, 0, rampField())
    expect(Array.from(a.indexMap)).toEqual(Array.from(b.indexMap))
    expect(a.palette).toEqual(b.palette)
    expect(Array.from(a.luminance)).toEqual(Array.from(b.luminance))
  })

  it('rejects a field that does not match the picture', () => {
    expect(() =>
      mapToLuminanceBands(halves(YELLOW, NAVY), 2, W, H, false, 0, undefined, undefined, 0, new Float32Array(10)),
    ).toThrow(/does not match/)
  })

  it('treats non-finite values as the base and clamps out-of-range ones', () => {
    const f = rampField()
    f[0] = NaN
    f[1] = -5
    f[2] = 7
    const q = mapToLuminanceBands(halves(YELLOW, NAVY), 2, W, H, false, 0, undefined, undefined, 0, f)
    for (const v of q.luminance) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('still applies the tone curve on top of the depth relief', () => {
    const plain = mapToLuminanceBands(halves(YELLOW, NAVY), 4, W, H, false, 0, undefined, undefined, 0, rampField())
    const toned = mapToLuminanceBands(halves(YELLOW, NAVY), 4, W, H, false, 0, { power: 2 }, undefined, 0, rampField())
    // Power > 1 sinks the mid-tones toward the base but leaves the slices where they were.
    expect(Array.from(toned.indexMap)).toEqual(Array.from(plain.indexMap))
    const mid = (H / 2) * W + 5
    expect(toned.luminance[mid]!).toBeLessThan(plain.luminance[mid]!)
  })
})

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

function task(overrides: Partial<QuantizeTask> = {}): QuantizeTask {
  return {
    type: 'quantize',
    id: 1,
    rgba: halves(YELLOW, NAVY),
    width: W,
    height: H,
    opts: opts(),
    reliefField: rampField(),
    ...overrides,
  }
}

beforeEach(() => resetWorkerState())

describe('worker: depth relief', () => {
  it('builds the geometry from the field: taller where the field is larger', () => {
    const r = runWorkerTask(task())
    const row = 8 * W
    expect(r.field.values[row + W - 1]!).toBeGreaterThan(r.field.values[row]!)
    expect(r.quantized.palette).toHaveLength(4)
  })

  it('prints in slice order whatever the brightness toggle says', () => {
    const r = runWorkerTask(task({ opts: opts({ darkIsTall: true }) }))
    expect(r.darkIsTall).toBe(false)
    expect(r.palette.map((p) => p.printOrder)).toEqual([1, 2, 3, 4])
  })

  it('keeps the same order on a later finish that still carries darkIsTall', () => {
    runWorkerTask(task({ opts: opts({ darkIsTall: true }) }))
    const finish: FinishTask = {
      type: 'finish',
      id: 2,
      opts: opts({ darkIsTall: true }),
      palette: [
        { r: 1, g: 1, b: 1 },
        { r: 2, g: 2, b: 2 },
        { r: 3, g: 3, b: 3 },
        { r: 4, g: 4, b: 4 },
      ],
    }
    const r = runWorkerTask(finish)
    expect(r.darkIsTall).toBe(false)
    expect(r.palette.map((p) => p.printOrder)).toEqual([1, 2, 3, 4])
  })

  it('returns to brightness ordering when the next quantize has no field', () => {
    runWorkerTask(task())
    const r = runWorkerTask(task({ reliefField: undefined, opts: opts({ darkIsTall: true }) }))
    expect(r.darkIsTall).toBe(true)
  })

  it('lets a depth relief replace the colors-first model instead of being ignored', () => {
    const image = runWorkerTask(task({ opts: opts({ colorMode: 'image' }) }))
    resetWorkerState()
    const luma = runWorkerTask(task({ opts: opts({ colorMode: 'luma' }) }))
    expect(Array.from(image.quantized.indexMap)).toEqual(Array.from(luma.quantized.indexMap))
    expect(image.quantized.palette).toEqual(luma.quantized.palette)
  })

  it('refuses to combine a depth relief with catalog (nearest-color) mode', () => {
    expect(() =>
      runWorkerTask(
        task({
          nearestPalette: true,
          paletteOverride: [
            { r: 0, g: 0, b: 0 },
            { r: 255, g: 255, b: 255 },
          ],
          opts: opts({ numColors: 2 }),
        }),
      ),
    ).toThrow(/catalog/)
  })

  it('rejects a field of the wrong size', () => {
    expect(() => runWorkerTask(task({ reliefField: new Float32Array(3) }))).toThrow(/does not match/)
  })

  it('fits the tone against the depth relief too', () => {
    const base = runWorkerTask(task())
    const target = measureOf(base.mesh.positions, base.mesh.triangleCount)
    const fit = runFitToneTask({
      type: 'fit-tone',
      id: 3,
      rgba: halves(YELLOW, NAVY),
      width: W,
      height: H,
      opts: opts(),
      target,
      reliefField: rampField(),
    })
    // The target IS the depth relief at the neutral tone, so the current tone is
    // already the best match. Had the fit measured the brightness relief instead
    // (which differs for this picture), the baseline could not sit near zero.
    expect(fit.baseline).toBeLessThan(0.02)
    expect(fit.improved).toBe(false)
    expect(fit.evaluations).toBeGreaterThan(1)
  })
})

function measureOf(positions: Float32Array, triangleCount: number): ReliefMetrics {
  return measureRelief(positions, triangleCount, { gridStepX: 40 / W, gridStepY: 40 / H })
}
