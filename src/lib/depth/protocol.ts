import type { DepthMap } from './depthMap'

/**
 * Messages between the app and `depth.worker.ts`. Types only — no runtime code —
 * so both sides and the tests share one contract without pulling the runtime in.
 */

/** Hand the worker the model and the wasm binary (transferred, zero-copy). */
export interface DepthInitTask {
  type: 'init'
  id: number
  model: ArrayBuffer
  wasm: ArrayBuffer
}

export interface DepthEstimateTask {
  type: 'estimate'
  id: number
  rgba: Uint8ClampedArray
  width: number
  height: number
}

export type DepthTask = DepthInitTask | DepthEstimateTask

/** Machine-readable failure class, mapped to a localized message by the UI. */
export type DepthErrorCode = 'model-load' | 'inference' | 'not-ready'

export type DepthReply =
  | { id: number; ok: true; type: 'init' }
  | { id: number; ok: true; type: 'estimate'; depth: DepthMap; flat: boolean }
  | { id: number; ok: false; code: DepthErrorCode; error: string }
