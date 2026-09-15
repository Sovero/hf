import { runReferenceAnalyze, runStlAnalyze } from '../lib/referenceWorkerProtocol'
import type { Reference3mfInput } from '../lib/reference3mf'
import type { StlInput } from '../lib/reliefCompare'

/**
 * Web Worker entry for reference analysis. Two tasks share the worker:
 *  - a reference .3mf (unzip + XML scan) and
 *  - a reference .stl (triangle soup read + relief metrics).
 * Both run off the main thread, so dropping a tens-of-megabytes reference
 * file never freezes the editor UI.
 */
type WorkerRequest =
  | { id: number; kind: 'stl'; input: StlInput }
  | { id: number; kind?: '3mf'; input: Reference3mfInput }

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
  postMessage(msg: unknown, transfer?: Transferable[]): void
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  if (!msg || typeof msg.id !== 'number' || !('input' in msg)) return

  if (msg.kind === 'stl') {
    ctx.postMessage({ id: msg.id, ...runStlAnalyze(msg.input) })
    return
  }

  void runReferenceAnalyze(msg.input as Reference3mfInput).then((response) => {
    ctx.postMessage({ id: msg.id, ...response })
  })
}
