/**
 * Relative depth map — the relief source that is not the picture's brightness.
 *
 * Values run 0..1 with **nearer = larger** (a nearer surface stands taller in
 * print). It is an ordering, never a distance: monocular depth has no scale, so
 * nothing here converts to millimetres; the user's base/max heights do that.
 */
export interface DepthMap {
  width: number
  height: number
  /** Row-major, `width * height` values in 0..1, nearer = larger. */
  data: Float32Array
}

/** Bins of the percentile histogram (fine enough for 16-bit maps, O(n)). */
const HIST_BINS = 4096

/** Percentiles the depth range is stretched between; the tails are clamped. */
export const DEPTH_LOW_PCT = 0.02
export const DEPTH_HIGH_PCT = 0.98

export interface NormalizedDepth {
  data: Float32Array
  /**
   * True when the input carried no usable depth range (a flat picture, a solid
   * map). The data is then all zeros — a flat relief, reported instead of a
   * range invented out of noise.
   */
  flat: boolean
}

/** Value below which `pct` (0..1) of `values` fall, from a histogram over [min, max]. */
function percentile(hist: Uint32Array, total: number, pct: number, min: number, step: number): number {
  const target = pct * total
  let acc = 0
  for (let b = 0; b < hist.length; b++) {
    acc += hist[b]!
    if (acc >= target) return min + (b + 0.5) * step
  }
  return min + hist.length * step
}

/**
 * Stretch raw model output to 0..1 between its 2nd and 98th percentiles.
 *
 * Percentiles rather than min/max: a handful of extreme pixels (a bright sky,
 * a specular hit) would otherwise squeeze the whole subject into a sliver of the
 * range and the relief would print nearly flat.
 */
export function normalizeDepth(raw: Float32Array): NormalizedDepth {
  const out = new Float32Array(raw.length)
  let min = Infinity
  let max = -Infinity
  let finite = 0
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]!
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
    finite++
  }
  if (finite === 0 || !(max - min > 1e-9)) return { data: out, flat: true }

  const step = (max - min) / HIST_BINS
  const hist = new Uint32Array(HIST_BINS)
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]!
    if (!Number.isFinite(v)) continue
    hist[Math.min(HIST_BINS - 1, Math.floor((v - min) / step))]!++
  }
  let lo = percentile(hist, finite, DEPTH_LOW_PCT, min, step)
  let hi = percentile(hist, finite, DEPTH_HIGH_PCT, min, step)
  // A picture dominated by one value can make the percentiles coincide; the
  // full range is then the honest fallback before calling it flat.
  if (!(hi - lo > 1e-9)) {
    lo = min
    hi = max
  }
  const span = hi - lo
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]!
    out[i] = Number.isFinite(v) ? Math.min(1, Math.max(0, (v - lo) / span)) : 0
  }
  return { data: out, flat: false }
}

/**
 * Stretch a supplied map to 0..1 between its own minimum and maximum.
 *
 * Unlike `normalizeDepth` this does not clip the tails: a map somebody made on
 * purpose (a depth tool's output, a sculpted height map) has levels that mean
 * something, and its extremes are not outliers. `background` marks pixels that
 * carry no depth (fully transparent) — they are left out of the range and set to
 * the base.
 */
export function normalizeMinMax(values: Float32Array, background?: Uint8Array): NormalizedDepth {
  const out = new Float32Array(values.length)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!
    if ((background && background[i]) || !Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!(max - min > 1e-9)) return { data: out, flat: true }
  const span = max - min
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!
    out[i] = (background && background[i]) || !Number.isFinite(v) ? 0 : (v - min) / span
  }
  return { data: out, flat: false }
}

/** Average `factor × factor` blocks (integer shrink) — the cheap, alias-free way down. */
function shrinkByBlocks(map: DepthMap, factor: number): DepthMap {
  const w = Math.floor(map.width / factor)
  const h = Math.floor(map.height / factor)
  const out = new Float32Array(w * h)
  const area = factor * factor
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * map.width + x * factor
        for (let dx = 0; dx < factor; dx++) sum += map.data[row + dx]!
      }
      out[y * w + x] = sum / area
    }
  }
  return { width: w, height: h, data: out }
}

/**
 * Resample a depth map to `width × height` (returns the input when the size
 * matches). Shrinking a lot averages blocks first: a supplied 4000-px map read at
 * a 300-px print grid by bilinear alone would sample one pixel in thirteen and
 * turn fine texture into noise.
 */
export function resampleDepth(input: DepthMap, width: number, height: number): DepthMap {
  if (input.width === width && input.height === height) return input
  let map = input
  const factor = Math.floor(Math.min(map.width / width, map.height / height) / 2)
  if (factor >= 2) map = shrinkByBlocks(map, factor)
  const out = new Float32Array(width * height)
  const sw = map.width
  const sh = map.height
  const src = map.data
  const xr = sw / width
  const yr = sh / height
  for (let y = 0; y < height; y++) {
    // Pixel-centre alignment: output pixel y covers source [y·yr, (y+1)·yr).
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * yr - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < width; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * xr - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const wx = fx - x0
      const top = src[y0 * sw + x0]! * (1 - wx) + src[y0 * sw + x1]! * wx
      const bottom = src[y1 * sw + x0]! * (1 - wx) + src[y1 * sw + x1]! * wx
      out[y * width + x] = top * (1 - wy) + bottom * wy
    }
  }
  return { width, height, data: out }
}

/**
 * The relief field a print needs: the depth map at the working resolution,
 * optionally flipped so the farther surface stands tallest ("invert depth").
 * Always a fresh array — the cached map must survive the pipeline's transfers.
 */
export function depthToRelief(map: DepthMap, width: number, height: number, invert = false): Float32Array {
  const resized = resampleDepth(map, width, height)
  const out = new Float32Array(resized.data.length)
  if (invert) for (let i = 0; i < out.length; i++) out[i] = 1 - resized.data[i]!
  else out.set(resized.data)
  return out
}
