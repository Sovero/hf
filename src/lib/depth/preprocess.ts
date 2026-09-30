/**
 * Input side of the depth model (Depth Anything V2): picture → CHW float tensor.
 *
 * Constants come from the model's own `preprocessor_config.json`
 * (`onnx-community/depth-anything-v2-small`): ImageNet mean/std over `rgb/255`,
 * both sides a multiple of 14 (the ViT patch size), target size 518.
 */

/** Long side the picture is fitted to before inference (the model's native size). */
export const DEPTH_LONG_SIDE = 518
/** The ViT patch size: both input sides must be a multiple of it. */
export const DEPTH_MULTIPLE = 14

const MEAN = [0.485, 0.456, 0.406] as const
const STD = [0.229, 0.224, 0.225] as const

export interface ModelSize {
  width: number
  height: number
}

/**
 * Inference size for a picture: the long side becomes `longSide`, the short one
 * follows the aspect ratio, and both are rounded to the patch multiple (never
 * below one patch). The long side is fitted rather than the short one because
 * the cost grows with the pixel count and a print does not need the extra.
 */
export function modelInputSize(
  width: number,
  height: number,
  longSide = DEPTH_LONG_SIDE,
  multiple = DEPTH_MULTIPLE,
): ModelSize {
  if (!(width > 0) || !(height > 0)) throw new Error('Image has no pixels')
  const scale = longSide / Math.max(width, height)
  const snap = (v: number) => Math.max(multiple, Math.round((v * scale) / multiple) * multiple)
  return { width: snap(width), height: snap(height) }
}

/** One axis of a separable resample: for each target index, the source taps and weights. */
interface AxisWeights {
  start: Int32Array
  count: Int32Array
  weights: Float32Array
  stride: number
}

/**
 * Weights that shrink by area (box filter over the covered source span — no
 * aliasing on a big photo) and enlarge bilinearly.
 */
function axisWeights(sourceLen: number, targetLen: number): AxisWeights {
  const ratio = sourceLen / targetLen
  const stride = ratio > 1 ? Math.ceil(ratio) + 2 : 2
  const start = new Int32Array(targetLen)
  const count = new Int32Array(targetLen)
  const weights = new Float32Array(targetLen * stride)
  for (let t = 0; t < targetLen; t++) {
    if (ratio > 1) {
      const a = t * ratio
      const b = (t + 1) * ratio
      const first = Math.floor(a)
      const last = Math.min(sourceLen - 1, Math.ceil(b) - 1)
      let sum = 0
      let n = 0
      for (let s = first; s <= last; s++) {
        const w = Math.min(b, s + 1) - Math.max(a, s)
        if (w <= 0) continue
        weights[t * stride + n++] = w
        sum += w
      }
      for (let k = 0; k < n; k++) weights[t * stride + k]! /= sum
      start[t] = first
      count[t] = n
    } else {
      const f = Math.min(sourceLen - 1, Math.max(0, (t + 0.5) * ratio - 0.5))
      const s0 = Math.floor(f)
      const s1 = Math.min(sourceLen - 1, s0 + 1)
      const w1 = f - s0
      start[t] = s0
      if (s1 === s0) {
        weights[t * stride] = 1
        count[t] = 1
      } else {
        weights[t * stride] = 1 - w1
        weights[t * stride + 1] = w1
        count[t] = 2
      }
    }
  }
  return { start, count, weights, stride }
}

/**
 * RGBA picture → normalized CHW float tensor of `targetWidth × targetHeight`.
 * Alpha is ignored; the layout is `[R plane][G plane][B plane]`.
 */
export function rgbaToModelInput(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): Float32Array {
  if (rgba.length < width * height * 4) throw new Error('RGBA buffer is smaller than width × height')
  const ax = axisWeights(width, targetWidth)
  const ay = axisWeights(height, targetHeight)
  const plane = targetWidth * targetHeight
  const out = new Float32Array(3 * plane)
  // Horizontal pass into one row buffer per source row would need the whole
  // intermediate; a row-at-a-time scratch of the source rows the vertical pass
  // needs keeps memory at a few rows instead of tw × h × 3 floats.
  const rowCache = new Map<number, Float32Array>()
  const horizontalRow = (sy: number): Float32Array => {
    let row = rowCache.get(sy)
    if (row) return row
    row = new Float32Array(targetWidth * 3)
    const base = sy * width * 4
    for (let tx = 0; tx < targetWidth; tx++) {
      let r = 0
      let g = 0
      let b = 0
      const s = ax.start[tx]!
      const n = ax.count[tx]!
      for (let k = 0; k < n; k++) {
        const w = ax.weights[tx * ax.stride + k]!
        const p = base + (s + k) * 4
        r += rgba[p]! * w
        g += rgba[p + 1]! * w
        b += rgba[p + 2]! * w
      }
      row[tx * 3] = r
      row[tx * 3 + 1] = g
      row[tx * 3 + 2] = b
    }
    rowCache.set(sy, row)
    return row
  }
  for (let ty = 0; ty < targetHeight; ty++) {
    const s = ay.start[ty]!
    const n = ay.count[ty]!
    // Source rows before the first this target row needs are never read again.
    for (const key of rowCache.keys()) if (key < s) rowCache.delete(key)
    for (let tx = 0; tx < targetWidth; tx++) {
      let r = 0
      let g = 0
      let b = 0
      for (let k = 0; k < n; k++) {
        const w = ay.weights[ty * ay.stride + k]!
        const row = horizontalRow(s + k)
        r += row[tx * 3]! * w
        g += row[tx * 3 + 1]! * w
        b += row[tx * 3 + 2]! * w
      }
      const o = ty * targetWidth + tx
      out[o] = (r / 255 - MEAN[0]) / STD[0]
      out[plane + o] = (g / 255 - MEAN[1]) / STD[1]
      out[2 * plane + o] = (b / 255 - MEAN[2]) / STD[2]
    }
  }
  return out
}
