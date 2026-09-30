import { depthToRelief, type DepthMap } from '../lib/depth/depthMap'
import { estimateDepth, DepthError, type DepthPhase } from './depthClient'

/**
 * The depth relief the editor asks for, kept apart from `main.ts`.
 *
 * Depth is estimated once per picture and reused: moving a slider, changing the
 * print size or the color count re-runs the pipeline many times, and none of
 * that changes what the network sees. The cache is keyed by the `File` object —
 * a new file (or a project reopened from disk) is a new object, so it can never
 * serve a stale map.
 */

/** Pixels the network looks at (the source decode, at most 2048 px on a side). */
export interface DepthPixels {
  rgba: Uint8ClampedArray
  width: number
  height: number
}

export interface DepthResult {
  depth: DepthMap
  /** The picture carried no usable depth range. */
  flat: boolean
  /** Wall-clock seconds this call spent estimating; `null` when it was served from the cache. */
  seconds: number | null
}

let cached: { file: File; depth: DepthMap; flat: boolean } | null = null
let inflight: { file: File; promise: Promise<DepthResult> } | null = null

/** Forget the cached map (a new picture, or the source was switched off). */
export function clearDepthCache(): void {
  cached = null
}

/** True when this file's depth is already known (no network run, no wait). */
export function hasDepthFor(file: File): boolean {
  return cached?.file === file
}

/**
 * Depth for `file`. `pixels` is a thunk so a cache hit costs no decode at all;
 * overlapping calls for the same file share one run.
 */
export function depthFor(
  file: File,
  pixels: () => Promise<DepthPixels>,
  onPhase?: (phase: DepthPhase) => void,
): Promise<DepthResult> {
  if (cached?.file === file) {
    return Promise.resolve({ depth: cached.depth, flat: cached.flat, seconds: null })
  }
  if (inflight?.file === file) return inflight.promise
  const started = performance.now()
  const promise = (async (): Promise<DepthResult> => {
    const px = await pixels()
    const { depth, flat } = await estimateDepth(px.rgba, px.width, px.height, onPhase)
    // Only remember the answer if nothing newer replaced the request meanwhile.
    if (inflight?.file === file) cached = { file, depth, flat }
    return { depth, flat, seconds: (performance.now() - started) / 1000 }
  })()
  const entry = { file, promise }
  inflight = entry
  const clear = () => {
    if (inflight === entry) inflight = null
  }
  promise.then(clear, clear)
  return promise
}

/** The relief field for the print grid: the depth map at that size, optionally flipped. */
export function reliefFieldFromDepth(depth: DepthMap, width: number, height: number, invert: boolean): Float32Array {
  return depthToRelief(depth, width, height, invert)
}

/** Which localized message explains a depth failure. */
export function depthErrorKey(err: unknown): 'depthErrorLoad' | 'depthErrorRun' {
  return err instanceof DepthError && err.code === 'model-load' ? 'depthErrorLoad' : 'depthErrorRun'
}

/** A short, single-line technical detail for the status message. */
export function depthErrorDetail(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/\s+/g, ' ').slice(0, 160)
}
