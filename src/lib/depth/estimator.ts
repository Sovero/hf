import * as ort from 'onnxruntime-web/wasm'
import { normalizeDepth, type DepthMap } from './depthMap'
import { modelInputSize, rgbaToModelInput } from './preprocess'

/**
 * Local depth estimation: Depth Anything V2 Small (uint8-quantized ONNX) on the
 * ONNX Runtime WebAssembly backend.
 *
 * The estimator never fetches anything: the caller hands it the model and the
 * wasm binary as bytes. That is what makes the same code work on the web (bytes
 * come from `fetch`), inside the desktop app (bytes come from the main process —
 * `file://` pages cannot `fetch` local files) and in Node tests.
 */

/** The two binaries the runtime needs. */
export interface DepthResources {
  /** `model_quantized.onnx`. */
  model: Uint8Array
  /** `ort-wasm-simd-threaded.wasm` — passed as bytes so ORT loads nothing itself. */
  wasm: Uint8Array
}

export interface DepthEstimator {
  /** Depth of an RGBA picture at the model's resolution (0..1, nearer = larger). */
  estimate(rgba: Uint8ClampedArray, width: number, height: number): Promise<DepthMap & { flat: boolean }>
  dispose(): Promise<void>
}

/** Input/output names of the exported model (checked against the file when loaded). */
const INPUT_NAME = 'pixel_values'
const OUTPUT_NAME = 'predicted_depth'

export async function createDepthEstimator(resources: DepthResources): Promise<DepthEstimator> {
  // One thread: multi-threading needs cross-origin isolation (COOP + COEP) that a
  // plain static deployment does not have, and one picture is ~5 s single-threaded.
  ort.env.wasm.numThreads = 1
  // With the binary supplied ORT skips its own fetch and dynamic import entirely
  // (the bundled build embeds the glue), so no URL is ever resolved.
  ort.env.wasm.wasmBinary = resources.wasm
  const session = await ort.InferenceSession.create(resources.model, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  if (!session.inputNames.includes(INPUT_NAME) || !session.outputNames.includes(OUTPUT_NAME)) {
    await session.release()
    throw new Error(
      `Unexpected depth model: inputs [${session.inputNames.join(', ')}], outputs [${session.outputNames.join(', ')}]`,
    )
  }

  return {
    async estimate(rgba, width, height) {
      const size = modelInputSize(width, height)
      const input = rgbaToModelInput(rgba, width, height, size.width, size.height)
      const tensor = new ort.Tensor('float32', input, [1, 3, size.height, size.width])
      const outputs = await session.run({ [INPUT_NAME]: tensor })
      const out = outputs[OUTPUT_NAME]
      if (!out || out.type !== 'float32') throw new Error('Depth model returned no float output')
      const data = out.data as Float32Array
      const dims = out.dims
      const outH = dims[dims.length - 2]!
      const outW = dims[dims.length - 1]!
      if (data.length !== outW * outH) throw new Error('Depth model output has an unexpected shape')
      const { data: normalized, flat } = normalizeDepth(data)
      return { width: outW, height: outH, data: normalized, flat }
    },
    async dispose() {
      await session.release()
    },
  }
}
