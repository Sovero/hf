import { Reference3mfParseError, type Reference3mfAnalysis, type Reference3mfInput } from '../lib/reference3mf'
import type { ReferenceWorkerResponse } from '../lib/referenceWorkerProtocol'

/**
 * Browser side of the reference-3MF parser worker. `parseReference3mfInWorker`
 * ships the file to the worker and resolves with the analysis; typed parse
 * errors are reconstructed on this side (structured clone strips custom
 * Error fields, so the code travels in the flattened response).
 */

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (a: Reference3mfAnalysis) => void; reject: (e: Error) => void }>()

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../worker/reference3mf.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: number } & ReferenceWorkerResponse>) => {
    const msg = e.data
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok && msg.result) {
      p.resolve(msg.result)
    } else if (msg.error?.code) {
      p.reject(new Reference3mfParseError(msg.error.code as Reference3mfParseError['code'], msg.error.message))
    } else {
      p.reject(new Error(msg.error?.message ?? 'Reference parser worker failed'))
    }
  }
  worker.onerror = (e) => {
    const err = new Error(`Reference parser worker error: ${e.message}`)
    for (const p of pending.values()) p.reject(err)
    pending.clear()
  }
  return worker
}

/** Analyze a reference 3MF off the main thread. */
export function parseReference3mfInWorker(input: Reference3mfInput): Promise<Reference3mfAnalysis> {
  const id = nextId++
  const w = ensureWorker()
  return new Promise<Reference3mfAnalysis>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, input })
  })
}