import type { DepthMap } from '../lib/depth/depthMap'
import type { DepthErrorCode, DepthReply, DepthTask } from '../lib/depth/protocol'
import { loadDepthResources } from './depthResources'

/**
 * Browser side of the depth worker.
 *
 * The model (27 MB) and the wasm runtime load lazily, on the first request, and
 * stay in the worker for the session — a second picture only pays for inference.
 * Requests are serialised: one ONNX Runtime session runs one inference at a time.
 */

export class DepthError extends Error {
  readonly code: DepthErrorCode
  constructor(code: DepthErrorCode, message: string) {
    super(message)
    this.name = 'DepthError'
    this.code = code
  }
}

/** What the request is doing now — the panel turns this into a status line. */
export type DepthPhase = 'loading' | 'estimating'

export interface DepthEstimate {
  depth: DepthMap
  /** The picture carried no usable depth range (solid colour, blank). */
  flat: boolean
}

interface Waiter {
  resolve: (r: DepthReply) => void
  reject: (e: Error) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Waiter>()
/** Set once the worker holds a loaded model; cleared by a load failure so the next call retries. */
let ready: Promise<void> | null = null
/** Tail of the request chain (serialisation). */
let chain: Promise<unknown> = Promise.resolve()

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../worker/depth.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<DepthReply>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    p.resolve(e.data)
  }
  worker.onerror = (e) => {
    const err = new DepthError('inference', `Depth worker error: ${e.message}`)
    for (const p of pending.values()) p.reject(err)
    pending.clear()
    // A crashed worker has lost its model; start over on the next request.
    worker?.terminate()
    worker = null
    ready = null
  }
  return worker
}

function send(task: DepthTask, transfer: Transferable[]): Promise<DepthReply> {
  return new Promise<DepthReply>((resolve, reject) => {
    pending.set(task.id, { resolve, reject })
    ensureWorker().postMessage(task, transfer)
  })
}

function asError(reply: Extract<DepthReply, { ok: false }>): DepthError {
  return new DepthError(reply.code, reply.error)
}

async function ensureModel(): Promise<void> {
  if (ready) return ready
  const attempt = (async () => {
    let resources: { model: ArrayBuffer; wasm: ArrayBuffer }
    try {
      resources = await loadDepthResources()
    } catch (err) {
      throw new DepthError('model-load', err instanceof Error ? err.message : String(err))
    }
    const reply = await send(
      { type: 'init', id: nextId++, model: resources.model, wasm: resources.wasm },
      [resources.model, resources.wasm],
    )
    if (!reply.ok) throw asError(reply)
  })()
  ready = attempt
  attempt.catch(() => {
    if (ready === attempt) ready = null
  })
  return attempt
}

/**
 * Depth of an RGBA picture. The pixels are copied, not transferred: the caller
 * keeps its decoded image for the next reprocess.
 */
export function estimateDepth(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  onPhase?: (phase: DepthPhase) => void,
): Promise<DepthEstimate> {
  const run = async (): Promise<DepthEstimate> => {
    onPhase?.('loading')
    await ensureModel()
    onPhase?.('estimating')
    const copy = rgba.slice()
    const reply = await send({ type: 'estimate', id: nextId++, rgba: copy, width, height }, [copy.buffer])
    if (!reply.ok) throw asError(reply)
    if (reply.type !== 'estimate') throw new DepthError('inference', 'Unexpected depth worker reply')
    return { depth: reply.depth, flat: reply.flat }
  }
  const result = chain.then(run, run)
  // The chain must survive a failed request, or one error would jam every later one.
  chain = result.catch(() => undefined)
  return result
}
