import { runFitToneTask, runWorkerTask, type WorkerResult, type WorkerTask } from '../lib/workerProtocol'

/**
 * Web Worker entry for the image pipeline. All computation happens in
 * `runWorkerTask` / `runFitToneTask` (pure modules); this file only bridges
 * messages and moves the big typed arrays across as transferables (zero-copy
 * in both directions). The worker keeps the quantized image as its own state,
 * so finish requests carry only small overrides.
 */
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerTask>) => void) | null
  postMessage(msg: unknown, transfer?: Transferable[]): void
}

function transfersOf(r: WorkerResult): Transferable[] {
  const list: Transferable[] = [
    r.quantized.indexMap.buffer,
    r.quantized.luminance.buffer,
    r.field.values.buffer,
    r.mesh.positions.buffer,
    r.mesh.colors.buffer,
  ]
  if (r.quantized.cleanIndexMap) list.push(r.quantized.cleanIndexMap.buffer)
  return list
}

ctx.onmessage = (e: MessageEvent<WorkerTask>) => {
  const task = e.data
  if (!task) return
  if (task.type === 'fit-tone') {
    // The tone fit is a search over a few dozen pipeline runs: it reports how
    // far along it is (same id, no `ok` field, so the client treats these as
    // progress rather than as the answer).
    try {
      const fit = runFitToneTask(task, (done, total) => {
        ctx.postMessage({ id: task.id, progress: { done, total } })
      })
      ctx.postMessage({ id: task.id, ok: true, fit })
    } catch (err) {
      ctx.postMessage({
        id: task.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return
  }
  if (task.type !== 'quantize' && task.type !== 'finish') return
  try {
    const result = runWorkerTask(task)
    ctx.postMessage({ id: task.id, ok: true, result }, transfersOf(result))
  } catch (err) {
    ctx.postMessage({
      id: task.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
