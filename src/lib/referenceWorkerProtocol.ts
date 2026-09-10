import { parseReference3mf, Reference3mfParseError, type Reference3mfAnalysis, type Reference3mfInput } from './reference3mf'

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
    return {
      ok: false,
      error: {
        name: err instanceof Error ? err.name : 'Error',
        message: err instanceof Error ? err.message : String(err),
      },
    }
  }
}