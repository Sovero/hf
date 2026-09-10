import { runReferenceAnalyze } from '../lib/referenceWorkerProtocol'
import type { Reference3mfInput } from '../lib/reference3mf'

/**
 * Web Worker entry for reference-3MF analysis. The heavy work (unzip +
 * XML scan) runs in `runReferenceAnalyze` (pure module) off the main
 * thread, so dropping a large .3mf never freezes the editor UI.
 */
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; input: Reference3mfInput }>) => void) | null
  postMessage(msg: unknown, transfer?: Transferable[]): void
}

ctx.onmessage = (e: MessageEvent<{ id: number; input: Reference3mfInput }>) => {
  const msg = e.data
  if (!msg || !('id' in msg) || !('input' in msg)) return
  void runReferenceAnalyze(msg.input).then((response) => {
    ctx.postMessage({ id: msg.id, ...response })
  })
}