import { mapToLuminanceBands, quantizeToPalette } from './quantize'
import { bilateralSmoothRGBA, smoothScalarField } from './smooth'
import { applyMerge, mergeMap } from './bandMerge'
import { finishPipeline, type PaletteEntry, type PipelineOptions } from './pipeline'
import { measureRelief, type ReliefMetrics } from './reliefCompare'
import { runToneFit, type ToneCandidate, type ToneFitResult } from './toneFit'
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
  /**
   * Catalog mode (HueForge-style): assign every pixel the NEAREST palette
   * color instead of a luminance band, with equal-thickness bands. Requires
   * `paletteOverride` (the chosen spool colors, dark → light).
   */
  nearestPalette?: boolean
  /**
   * Merge adjacent palette bands whose colors sit closer than this ΔE
   * (CIE76) — near-duplicate spools collapse into one, and their pixels
   * remap to the survivor. 0 (default) disables the pass.
   */
  mergeDeltaE?: number
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

export interface FitToneTask {
  type: 'fit-tone'
  /** Echoed back so the caller can match responses to requests. */
  id: number
  rgba: Uint8ClampedArray
  width: number
  height: number
  /** Everything the pipeline needs; `contrast`/`power` are what gets fitted. */
  opts: PipelineOptions
  /** The reference worth fitting to (only its relief shape is read). */
  target: ReliefMetrics
  /**
   * The tone in use now (the sliders' values as multipliers). Optional: the
   * neutral 1/1 is assumed, which is what an untouched project holds.
   */
  current?: ToneCandidate
}

export type WorkerTask = QuantizeTask | FinishTask | FitToneTask

/** Everything main thread needs to reconstruct a PipelineResult (minus image). */
export interface WorkerResult {
  quantized: QuantizedImage
  palette: PaletteEntry[]
  field: HeightField
  mesh: Mesh
  darkIsTall: boolean
  settings: ReturnType<typeof finishPipeline>['settings']
  /**
   * Present only when the ΔE merge ran: for every NEW slot j, the OLD
   * palette slot it came from (kept[j]). Lets the UI remap per-slot state
   * (filament assignments) through the merge.
   */
  mergeKept?: number[]
}

/** Worker-side state: the quantized image of the most recent quantize. */
let quantized: QuantizedImage | null = null

/**
 * Post-quantize cleanup: collapse adjacent near-duplicate bands (ΔE below
 * the threshold) and remap the label maps to the surviving slots. Applied
 * to both label maps (clean + dithered) so previews, exports and
 * printability all see the merged image.
 *
 * The merged band keeps the union of its members' height ranges (top = the
 * highest old top in the group; custom thicknesses sum): the relief keeps
 * its steps — they just show one filament now. `opts.bandHeightsMm` is
 * rewritten to the summed groups so finishPipeline accepts the new count.
 */
function applyBandMerge(q: QuantizedImage, threshold: number, opts: PipelineOptions): void {
  const map = mergeMap(q.palette, threshold)
  if (map.every((t, i) => t === i)) {
    lastMergeKept = null
    return
  }
  const remap = (labels: Uint8Array) => applyMerge(labels, map).indexMap
  const clean = q.cleanIndexMap ?? q.indexMap
  q.indexMap = remap(q.indexMap)
  if (q.cleanIndexMap) q.cleanIndexMap = remap(clean)

  const n = map.length
  const kept: number[] = []
  for (let i = 0; i < n; i++) if (map[i] === i) kept.push(i)
  lastMergeKept = kept
  q.palette = kept.map((i) => q.palette[i])

  // Group the old slots into runs that share a survivor; a group's top is
  // its last member's old top (tops are increasing).
  const source = q.bandHeightsMm && q.bandHeightsMm.length === n ? q.bandHeightsMm : null
  const newTops: number[] = []
  const newHeights: number[] = []
  let acc = 0
  for (let i = 0; i < n; i++) {
    if (source) acc += source[i]
    if (i === n - 1 || map[i + 1] === i + 1) {
      newTops.push(q.bandTops[i] ?? 1)
      if (source) {
        newHeights.push(acc)
        acc = 0
      }
    }
  }
  q.bandTops = newTops
  if (source) {
    q.bandHeightsMm = newHeights
    opts.bandHeightsMm = newHeights
  }
  // τ is a property of the physical filament — survivors keep their own.
  if (q.tauMm && q.tauMm.length === n) {
    q.tauMm = kept.map((i) => q.tauMm![i])
  }
}

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

/** Kept-slot report from the last merge on this quantize (see WorkerResult). */
let lastMergeKept: number[] | null = null

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
    mergeKept: lastMergeKept ?? undefined,
  }
}

/**
 * One quantization pass, with the same palette / band-top overrides, custom
 * thickness seeding and ΔE merge the `quantize` task applies. `opts` is
 * mutated by the merge pass exactly as before, so callers that reuse an options
 * object across passes hand in a fresh copy.
 */
function quantizeOnce(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: PipelineOptions,
  overrides: { palette?: RGB[] | null; bandTops?: number[] | null; nearest?: boolean } | null,
  mergeDeltaE: number | undefined,
): QuantizedImage {
  // Edge-preserving smoothing of the SOURCE image (clean fills): the palette
  // and the color assignment are built from already-flat surfaces, while
  // sharp edges survive. Strength 0 skips the copy entirely.
  const smooth = Number.isFinite(opts.smooth) ? Math.min(1, Math.max(0, opts.smooth!)) : 0
  const source = smooth > 0 && width > 1 && height > 1 ? bilateralSmoothRGBA(rgba, width, height, smooth) : rgba
  let q: QuantizedImage
  if (overrides?.nearest && overrides.palette && overrides.palette.length > 1) {
    q = quantizeToPalette(source, overrides.palette, width, height, opts.dither ?? 0)
  } else {
    q = mapToLuminanceBands(
      source,
      opts.numColors,
      width,
      height,
      opts.darkIsTall,
      opts.dither ?? 0,
      { contrast: opts.contrast, power: opts.power },
    )
    if (overrides?.palette && overrides.palette.length === q.palette.length) {
      q.palette = overrides.palette.map((c) => ({ ...c }))
    }
    if (overrides?.bandTops) q.bandTops = [...overrides.bandTops]
  }
  // Relief smoothing: the stored luminance is the height map's input, so
  // smoothing it here means previews, mesh, exports and printability all
  // share one smoothed field. The color assignment above stays untouched.
  if (smooth > 0 && q.luminance.length === width * height) {
    q.luminance = smoothScalarField(q.luminance, width, height, smooth)
  }
  // Seed custom per-band thicknesses so the merge pass can carry them
  // through (finishPipeline re-applies them to the merged lengths).
  const customHeights = opts.bandHeightsMm
  if (
    customHeights &&
    customHeights.length === q.palette.length &&
    customHeights.every((h) => Number.isFinite(h) && h > 0)
  ) {
    q.bandHeightsMm = [...customHeights]
  }
  if (mergeDeltaE && mergeDeltaE > 0) applyBandMerge(q, mergeDeltaE, opts)
  return q
}

/**
 * Auto-fit the relief tone to a reference: run the pipeline once per candidate
 * setting and keep the one whose measured relief comes closest. Runs entirely
 * inside the worker — a full search is a few dozen pipeline passes, far too
 * much for the main thread — and reports progress so the UI can say how far
 * along it is. The worker's stored quantized image is left untouched: the
 * caller re-quantizes with the winner afterwards.
 */
export function runFitToneTask(
  task: FitToneTask,
  onProgress?: (done: number, total: number) => void,
): ToneFitResult {
  const known = {
    gridStepX: task.width > 0 ? task.opts.widthMm / task.width : 0,
    gridStepY: task.height > 0 ? task.opts.heightMm / task.height : 0,
  }
  // Host the expensive RGBA smoothing once for the whole search: every
  // candidate quantizes from the same smoothed source (smooth=0 inside
  // quantizeOnce skips the per-candidate repeat). The scalar relief smoothing
  // stays per-candidate — it is part of the measured relief.
  const smooth = Number.isFinite(task.opts.smooth) ? Math.min(1, Math.max(0, task.opts.smooth!)) : 0
  const source =
    smooth > 0 && task.width > 1 && task.height > 1 ? bilateralSmoothRGBA(task.rgba, task.width, task.height, smooth) : task.rgba
  // Every candidate runs the ΔE merge, which updates the module-level
  // kept-slot report. That report belongs to the quantize task: leaving a
  // candidate's report behind would make the next finish request remap the
  // caller's filament assignments to a palette that was never applied.
  const keptBefore = lastMergeKept
  try {
    return runToneFit(
      task.target,
      (candidate) => {
        // A fresh options object per candidate: the ΔE merge rewrites
        // `bandHeightsMm` on it, and one candidate must not poison the next.
        const opts: PipelineOptions = { ...task.opts, contrast: candidate.contrast, power: candidate.power }
        const q = quantizeOnce(source, task.width, task.height, { ...opts, smooth: 0 }, null, opts.mergeDeltaE)
        const dummyImage = { width: task.width, height: task.height, rgba: new Uint8ClampedArray(0) }
        const result = finishPipeline(dummyImage, q, opts)
        return measureRelief(result.mesh.positions, result.mesh.triangleCount, known)
      },
      onProgress,
      task.current,
    )
  } finally {
    lastMergeKept = keptBefore
  }
}

/** Run one task; throws Error with a user-presentable message on misuse. */
export function runWorkerTask(task: WorkerTask): WorkerResult {
  if (task.type === 'fit-tone') {
    throw new Error('fit-tone runs through runFitToneTask')
  }
  if (task.type === 'quantize') {
    lastMergeKept = null
    const q = quantizeOnce(
      task.rgba,
      task.width,
      task.height,
      task.opts,
      { palette: task.paletteOverride, bandTops: task.bandTopsOverride, nearest: task.nearestPalette },
      task.mergeDeltaE,
    )
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