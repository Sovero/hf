import { parseReference3mf, Reference3mfParseError, type Reference3mfAnalysis, type Reference3mfInput } from './reference3mf'
import { measureRelief, parseStl, StlParseError, type ReliefMetrics, type StlInput } from './reliefCompare'

/**
 * Serialized outcome of a reference-3MF analysis, safe to cross a
 * postMessage boundary (custom Error fields like `code` do not survive
 * structured clone, so the error is flattened here).
 */
export interface ReferenceWorkerResponse {
  ok: boolean
  result?: Reference3mfAnalysis
  error?: { name: string; message: string; code?: string }
}

/** Measurements taken off a reference STL, serializable for postMessage. */
export interface StlAnalysis {
  fileName: string
  fileSizeBytes: number
  format: 'binary' | 'ascii'
  truncated: boolean
  metrics: ReliefMetrics
}

export interface StlWorkerResponse {
  ok: boolean
  result?: StlAnalysis
  error?: { name: string; message: string; code?: string }
}

function flattenError(err: unknown): { name: string; message: string; code?: string } {
  const code = (err as { code?: unknown } | null)?.code
  return {
    name: err instanceof Error ? err.name : 'Error',
    message: err instanceof Error ? err.message : String(err),
    code: typeof code === 'string' ? code : undefined,
  }
}

/**
 * Analyze a reference 3MF inside the worker and flatten the outcome for
 * postMessage. Pure module (no worker globals) so it is directly
 * unit-testable in Node — the worker entry is a thin shell around it.
 */
export async function runReferenceAnalyze(input: Reference3mfInput): Promise<ReferenceWorkerResponse> {
  try {
    const result = await parseReference3mf(input)
    return { ok: true, result }
  } catch (err) {
    if (err instanceof Reference3mfParseError) {
      return { ok: false, error: { name: err.name, message: err.message, code: err.code } }
    }
    return { ok: false, error: flattenError(err) }
  }
}

/**
 * Read a reference STL and measure its relief. Runs off the main thread for
 * the same reason as the 3MF path: a HueForge STL is tens of megabytes and
 * parsing it must not stall the editor.
 */
export function runStlAnalyze(input: StlInput): StlWorkerResponse {
  try {
    const mesh = parseStl(input)
    return {
      ok: true,
      result: {
        fileName: input.fileName,
        fileSizeBytes: input.data.byteLength,
        format: mesh.format,
        truncated: mesh.truncated,
        metrics: measureRelief(mesh.positions, mesh.triangleCount),
      },
    }
  } catch (err) {
    if (err instanceof StlParseError) {
      return { ok: false, error: { name: err.name, message: err.message, code: err.code } }
    }
    return { ok: false, error: flattenError(err) }
  }
}
