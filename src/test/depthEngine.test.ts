import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createDepthEstimator } from '../lib/depth/estimator'
import { modelInputSize } from '../lib/depth/preprocess'

const MODEL = fileURLToPath(new URL('../assets/depth-anything-v2-small/model_quantized.onnx', import.meta.url))
const WASM = fileURLToPath(
  new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', import.meta.url),
)

/**
 * A scene whose depth order is known without asking the model: a sky above a
 * horizon and a checkered ground plane receding toward it. Whatever else is
 * uncertain about monocular depth, the ground at the bottom of the frame is
 * nearer than the ground at the horizon, and both are nearer than the sky.
 */
function groundScene(w: number, h: number, horizon: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r: number, g: number, b: number
      if (y < horizon) {
        const t = y / horizon
        r = 120 + 90 * t
        g = 170 + 60 * t
        b = 235 + 15 * t
      } else {
        const d = y - horizon + 1
        const u = Math.floor(((x - w / 2) / d) * 6)
        const v = Math.floor(400 / d)
        const tile = (u + v) & 1
        r = tile ? 70 : 150
        g = tile ? 130 : 190
        b = tile ? 60 : 90
      }
      px.set([r, g, b, 255], (y * w + x) * 4)
    }
  }
  return px
}

function meanRows(depth: { width: number; data: Float32Array }, from: number, to: number): number {
  let sum = 0
  let n = 0
  for (let y = from; y < to; y++) {
    for (let x = 0; x < depth.width; x++) {
      sum += depth.data[y * depth.width + x]!
      n++
    }
  }
  return sum / n
}

describe.skipIf(!existsSync(MODEL) || !existsSync(WASM))('depth engine with the bundled model', () => {
  it('runs the real model and orders a ground scene near-to-far correctly', async () => {
    const W = 320
    const H = 240
    const horizon = 90
    const estimator = await createDepthEstimator({
      model: new Uint8Array(readFileSync(MODEL)),
      wasm: new Uint8Array(readFileSync(WASM)),
    })
    try {
      const depth = await estimator.estimate(groundScene(W, H, horizon), W, H)
      const size = modelInputSize(W, H)
      expect(depth.width).toBe(size.width)
      expect(depth.height).toBe(size.height)
      expect(depth.flat).toBe(false)
      expect(depth.data.length).toBe(size.width * size.height)
      for (const v of depth.data) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }

      const rowOf = (y: number) => Math.round((y / H) * depth.height)
      const sky = meanRows(depth, rowOf(5), rowOf(70))
      const farGround = meanRows(depth, rowOf(96), rowOf(115))
      const nearGround = meanRows(depth, rowOf(215), rowOf(238))

      // Nearer = larger: the bottom of the frame must read as the nearest surface.
      expect(nearGround).toBeGreaterThan(farGround + 0.1)
      expect(nearGround).toBeGreaterThan(sky + 0.1)
    } finally {
      await estimator.dispose()
    }
  }, 180_000)
})
