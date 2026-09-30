import modelUrl from '../assets/depth-anything-v2-small/model_quantized.onnx?url'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

/**
 * Where the depth model and the WebAssembly runtime come from: both ship inside
 * the build (Vite emits them as hashed assets next to the code), so nothing is
 * downloaded from the internet.
 *
 * A plain `fetch` of our own files is enough in every shell — the browser build,
 * the deploy package, and the desktop app opened from `file://` (checked against
 * the packaged Electron: both files read back byte-for-byte from `app.asar`).
 */

async function readAsset(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`)
  return response.arrayBuffer()
}

/** Model and runtime bytes, loaded together. */
export async function loadDepthResources(): Promise<{ model: ArrayBuffer; wasm: ArrayBuffer }> {
  const [model, wasm] = await Promise.all([readAsset(modelUrl), readAsset(wasmUrl)])
  return { model, wasm }
}
