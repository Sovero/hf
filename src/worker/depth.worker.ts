import { createDepthEstimator, type DepthEstimator } from '../lib/depth/estimator'
import type { DepthReply, DepthTask } from '../lib/depth/protocol'

/**
 * Web Worker entry for depth estimation. Kept apart from the pipeline worker on
 * purpose: the wasm runtime and a 27 MB model must not load — or block — the
 * worker that rebuilds geometry on every slider move.
 */
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<DepthTask>) => void) | null
  postMessage(msg: DepthReply, transfer?: Transferable[]): void
}

let estimator: DepthEstimator | null = null

ctx.onmessage = async (e: MessageEvent<DepthTask>) => {
  const task = e.data
  if (!task) return
  if (task.type === 'init') {
    try {
      await estimator?.dispose()
      estimator = null
      estimator = await createDepthEstimator({
        model: new Uint8Array(task.model),
        wasm: new Uint8Array(task.wasm),
      })
      ctx.postMessage({ id: task.id, ok: true, type: 'init' })
    } catch (err) {
      ctx.postMessage({
        id: task.id,
        ok: false,
        code: 'model-load',
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return
  }
  if (task.type !== 'estimate') return
  if (!estimator) {
    ctx.postMessage({ id: task.id, ok: false, code: 'not-ready', error: 'Depth model is not loaded' })
    return
  }
  try {
    const { flat, ...depth } = await estimator.estimate(task.rgba, task.width, task.height)
    ctx.postMessage({ id: task.id, ok: true, type: 'estimate', depth, flat }, [depth.data.buffer])
  } catch (err) {
    ctx.postMessage({
      id: task.id,
      ok: false,
      code: 'inference',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
