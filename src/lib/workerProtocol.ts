import { mapToLuminanceBands } from './quantize'
import { finishPipeline, type PaletteEntry, type PipelineOptions } from './pipeline'
import type { HeightField, Mesh, QuantizedImage, RGB } from './types'

/**
 * Web Worker protocol for the image pipeline. Pure module — no DOM, no worker
 * globals — so the handler is directly unit-testable in Node and the worker
 * entry file is a thin shell around it.
 *
 * The worker owns the quantized image: a `quantize` request replaces it, and
 * subsequent `finish` requests rebuild geometry from it with only small
 * overrides (palette colors, band heights, band tops) crossing the wire.
 * Big arrays travel as transferables; the handler always returns fresh
 * copies so transferring them never detaches the worker's state.
 */

/** First half of the pipeline: decode input is RGBA, output is the quantized image. */
export interface QuantizeTask {
  type: 'quantize'
  /** Echoed back so the caller can match responses to requests. */
  id: number
  rgba: Uint8ClampedArray
  width: number
  height: number
  /** Everything the finish step needs; also carries bandHeightsMm. */
  opts: PipelineOptions
  /** Reference-apply: override the auto-derived palette (dark → light). */
  paletteOverride?: RGB[] | null
  /** Reference-apply: override the band boundaries (fractions of usable height). */
  bandTopsOverride?: number[] | null
}

/** Second half: rebuild geometry from the stored quantized image. */
export interface FinishTask {
  type: 'finish'
  id: number
  opts: PipelineOptions
  /** Full palette (dark → light) — replaces the stored one slot by slot. */
  palette: RGB[]
  /** Reference-apply only. */
  bandTopsOverride?: number[] | null
}

export type WorkerTask = QuantizeTask | FinishTask

/** Everything main thread needs to reconstruct a PipelineResult (minus image). */
export interface WorkerResult {
  quantized: QuantizedImage
  palette: PaletteEntry[]
  field: HeightField
  mesh: Mesh
  darkIsTall: boolean
  settings: ReturnType<typeof finishPipeline>['settings']
}

/** Worker-side state: the quantized image of the most recent quantize. */
let quantized: QuantizedImage | null = null

/** Fresh copies of the big arrays, safe to transfer without detaching state. */
function snapshot(q: QuantizedImage): QuantizedImage {
  return {
    ...q,
    palette: q.palette.map((c) => ({ ...c })),
    bandTops: [...q.bandTops],
    tauMm: q.tauMm ? [...q.tauMm] : undefined,
    bandHeightsMm: q.bandHeightsMm ? [...q.bandHeightsMm] : undefined,
    indexMap: q.indexMap.slice(),
    luminance: q.luminance.slice(),
    cleanIndexMap: q.cleanIndexMap ? q.cleanIndexMap.slice() : undefined,
  }
}

function runFinish(q: QuantizedImage, opts: PipelineOptions): WorkerResult {
  const dummyImage = { width: q.width, height: q.height, rgba: new Uint8ClampedArray(0) }
  const result = finishPipeline(dummyImage, q, opts)
  return {
    quantized: snapshot(result.quantized),
    palette: result.palette.map((p) => ({ ...p, color: { ...p.color } })),
    field: result.field,
    mesh: result.mesh,
    darkIsTall: result.darkIsTall,
    settings: result.settings,
  }
}

/** Run one task; throws Error with a user-presentable message on misuse. */
export function runWorkerTask(task: WorkerTask): WorkerResult {
  if (task.type === 'quantize') {
    const q = mapToLuminanceBands(
      task.rgba,
      task.opts.numColors,
      task.width,
      task.height,
      task.opts.darkIsTall,
      task.opts.dither ?? 0,
    )
    if (task.paletteOverride && task.paletteOverride.length === q.palette.length) {
      q.palette = task.paletteOverride.map((c) => ({ ...c }))
    }
    if (task.bandTopsOverride) q.bandTops = [...task.bandTopsOverride]
    quantized = q
    return runFinish(q, task.opts)
  }
  if (!quantized) throw new Error('No image processed yet — load an image first.')
  if (task.palette.length === quantized.palette.length) {
    quantized.palette = task.palette.map((c) => ({ ...c }))
  }
  if (task.bandTopsOverride) quantized.bandTops = [...task.bandTopsOverride]
  return runFinish(quantized, task.opts)
}

/** Reset worker-side state (used between test cases; harmless in prod). */
export function resetWorkerState(): void {
  quantized = null
}