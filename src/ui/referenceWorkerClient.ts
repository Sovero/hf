import { Reference3mfParseError, type Reference3mfAnalysis, type Reference3mfInput } from '../lib/reference3mf'
import { StlParseError, type StlInput } from '../lib/reliefCompare'
import type { ReferenceWorkerResponse, StlAnalysis, StlWorkerResponse } from '../lib/referenceWorkerProtocol'

/**
 * Browser side of the reference-analysis worker. `parseReference3mfInWorker`
 * and `analyzeStlInWorker` ship the file to the worker and resolve with the
 * analysis; typed parse errors are reconstructed on this side (structured
 * clone strips custom Error fields, so the code travels in the flattened
 * response).
 */

type Pending =
  | { kind: '3mf'; resolve: (a: Reference3mfAnalysis) => void; reject: (e: Error) => void }
  | { kind: 'stl'; resolve: (a: StlAnalysis) => void; reject: (e: Error) => void }

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../worker/reference3mf.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: number } & (ReferenceWorkerResponse | StlWorkerResponse)>) => {
    const msg = e.data
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    const { error } = msg as { error?: { message: string; code?: string } }
    if (msg.ok && msg.result) {
      if (p.kind === 'stl') (p.resolve as (a: StlAnalysis) => void)(msg.result as StlAnalysis)
      else (p.resolve as (a: Reference3mfAnalysis) => void)(msg.result as Reference3mfAnalysis)
    } else if (error?.code && p.kind === 'stl') {
      p.reject(new StlParseError(error.code as StlParseError['code'], error.message))
    } else if (error?.code) {
      p.reject(new Reference3mfParseError(error.code as Reference3mfParseError['code'], error.message))
    } else {
      p.reject(new Error(error?.message ?? 'Reference parser worker failed'))
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
    pending.set(id, { kind: '3mf', resolve, reject })
    w.postMessage({ id, kind: '3mf', input })
  })
}

/** Read a reference STL and measure its relief, off the main thread. */
export function analyzeStlInWorker(input: StlInput): Promise<StlAnalysis> {
  const id = nextId++
  const w = ensureWorker()
  return new Promise<StlAnalysis>((resolve, reject) => {
    pending.set(id, { kind: 'stl', resolve, reject })
    w.postMessage({ id, kind: 'stl', input })
  })
}
