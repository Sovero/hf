import type { PipelineOptions } from '../lib/pipeline'
import type { WorkerResult } from '../lib/workerProtocol'
import type { RGB } from '../lib/types'

/**
 * Browser side of the pipeline worker.
 *
 * `quantizeInWorker` runs the full quantization + geometry build (image
 * loads, live reprocess while dragging the colors/dither/size sliders).
 * `rebuildInWorker` rebuilds geometry from the worker's stored quantized
 * image (palette color edits, band height sliders, reference apply) with
 * coalescing: while one finish request is in flight, later calls replace the
 * queued snapshot instead of piling up, so a drag never queues a backlog —
 * the worker always converges on the latest desired state.
 *
 * Every rebuild result is also pushed to the listener registered with
 * `setResultListener` as it lands (so previews update live); the returned
 * promise resolves when the queue drains (for a final full UI refresh).
 */

export interface RebuildState {
  opts: PipelineOptions
  /** Full palette (dark → light), slot-by-slot override. */
  palette: RGB[]
  bandTopsOverride?: number[] | null
  /** Caller-side ordering guards, echoed to the listener. */
  token: number
  version: number
}

interface Waiters {
  resolve: (r: WorkerResult) => void
  reject: (e: Error) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Waiters>()

/** Coalescing state for finish requests. */
let inflight = false
let queued: RebuildState | null = null
let waiters: Waiters[] = []

let listener: ((r: WorkerResult, token: number, version: number) => void) | null = null

export function setResultListener(
  fn: ((r: WorkerResult, token: number, version: number) => void) | null,
): void {
  listener = fn
}

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../worker/pipeline.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data as { id: number; ok: boolean; result?: WorkerResult; error?: string }
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok && msg.result) p.resolve(msg.result)
    else p.reject(new Error(msg.error ?? 'Pipeline worker failed'))
  }
  worker.onerror = (e) => {
    const err = new Error(`Pipeline worker error: ${e.message}`)
    for (const p of pending.values()) p.reject(err)
    pending.clear()
  }
  return worker
}

/** Full pipeline: quantize + geometry, replacing the worker's stored image. */
export function quantizeInWorker(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: PipelineOptions,
  overrides?: { palette?: RGB[]; bandTops?: number[]; nearest?: boolean } | null,
): Promise<WorkerResult> {
  const id = nextId++
  const w = ensureWorker()
  return new Promise<WorkerResult>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage(
      {
        type: 'quantize',
        id,
        rgba,
        width,
        height,
        opts,
        paletteOverride: overrides?.palette,
        bandTopsOverride: overrides?.bandTops,
        nearestPalette: overrides?.nearest,
      },
      [rgba.buffer],
    )
  })
}

/**
 * Rebuild geometry from the stored quantized image. Coalesced: the latest
 * state replaces any queued one; the returned promise resolves when the
 * queue has fully drained with the final result.
 */
export function rebuildInWorker(state: RebuildState): Promise<WorkerResult> {
  queued = state
  if (!inflight) {
    inflight = true
    void pump()
  }
  return new Promise<WorkerResult>((resolve, reject) => {
    waiters.push({ resolve, reject })
  })
}

async function pump(): Promise<void> {
  try {
    let last: WorkerResult | null = null
    while (queued) {
      const state = queued
      queued = null
      last = await sendFinish(state)
      if (state.token !== undefined && listener) listener(last, state.token, state.version)
    }
    if (last) {
      for (const w of waiters) w.resolve(last)
    } else {
      // Nothing was ever queued — nothing to settle with a result; resolve
      // with a sentinel error-free no-op path (cannot happen in practice).
      for (const w of waiters) w.reject(new Error('Nothing to rebuild'))
    }
  } catch (err) {
    for (const w of waiters) w.reject(err instanceof Error ? err : new Error(String(err)))
  } finally {
    waiters = []
    inflight = false
  }
}

function sendFinish(state: RebuildState): Promise<WorkerResult> {
  const id = nextId++
  return new Promise<WorkerResult>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ensureWorker().postMessage({
      type: 'finish',
      id,
      opts: state.opts,
      palette: state.palette,
      ...(state.bandTopsOverride ? { bandTopsOverride: state.bandTopsOverride } : {}),
    })
  })
}