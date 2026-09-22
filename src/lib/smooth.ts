/**
 * Edge-preserving smoothing (bilateral filter) for the pipeline's two
 * smoothing points: the RGBA image before quantization (clean fills) and the
 * per-pixel relief field (no more pixel-noise "himalayas"). A bilateral
 * filter averages neighbours but weights them by brightness similarity, so
 * flat areas and gradients flatten out while sharp edges keep their step.
 *
 * Pure module — no DOM, no worker globals — directly unit-testable in Node.
 *
 * Strength is a single 0..1 number: 0 returns the input untouched (identity,
 * zero cost), higher values grow the kernel radius (1..3 cells) and blend the
 * filtered result with the original. The edge threshold (what counts as a
 * "border") differs per domain and is fixed inside — callers only see one knob.
 *
 * The knob is shared, but the callers are not equivalent: the COLOR pass must
 * not follow it into wide kernels (the band boundaries are read from its
 * luminance, and a wide kernel erases the picture's shapes), which is what
 * `colorDetailStrength` caps. The relief pass is the opposite — it wants tens
 * of pixels (see `reliefLowPassField`).
 */

/** Kernel radius in cells for a strength value (0 → 0, 1 → 3). */
function radiusOf(strength: number): number {
  if (!(strength > 0)) return 0
  return Math.min(3, Math.max(1, Math.round(strength * 3)))
}

/**
 * Ceiling of the color/detail pass — one cell, plus a partial blend.
 *
 * The slider is shared with the relief pass, but the two passes want opposite
 * kernels. The relief pass must reach tens of pixels: that is what turns
 * cliffs into slopes. The color pass decides the picture's SHAPES — the band
 * boundaries are read from its luminance — so a wide kernel turns a face into
 * a blob. Capped at one cell: enough to take sensor noise off the palette,
 * never enough to eat structure.
 */
const COLOR_DETAIL_MAX = 0.34

/**
 * Strength the COLOR pass actually uses for a slider value. Cheap by design:
 * the knob keeps meaning "how much smoothing", but the color pass refuses to
 * follow it into structure-destroying kernels (see `COLOR_DETAIL_MAX`).
 */
export function colorDetailStrength(strength: number): number {
  const k = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0
  return Math.min(COLOR_DETAIL_MAX, k)
}

/** Cached exp weights for a window: spatial part (same for every pixel). */
function spatialWeights(r: number): Float32Array {
  const size = 2 * r + 1
  const w = new Float32Array(size * size)
  const sigma = r / 1.5
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) w[(dy + r) * size + (dx + r)] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
  return w
}

const LUMA_R = 0.299
const LUMA_G = 0.587
const LUMA_B = 0.114
/** Range sigma for RGBA: luminance distance in 0..255 that still counts as "same surface". */
const SIGMA_RGBA = 60
/** Range sigma for the scalar relief field (0..1 domain). */
const SIGMA_SCALAR = 0.15

export function bilateralSmoothRGBA(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  strength: number,
): Uint8ClampedArray {
  const r = radiusOf(strength)
  if (r === 0 || width < 1 || height < 1) return rgba
  const out = new Uint8ClampedArray(rgba.length)
  const size = 2 * r + 1
  const spatial = spatialWeights(r)
  const twoSigma2 = 2 * SIGMA_RGBA * SIGMA_RGBA
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const p = idx * 4
      const cr = rgba[p]
      const cg = rgba[p + 1]
      const cb = rgba[p + 2]
      const centerLum = LUMA_R * cr + LUMA_G * cg + LUMA_B * cb
      let wSum = 0
      let accR = 0
      let accG = 0
      let accB = 0
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy))
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx))
          const q = (yy * width + xx) * 4
          const qr = rgba[q]
          const qg = rgba[q + 1]
          const qb = rgba[q + 2]
          const lum = LUMA_R * qr + LUMA_G * qg + LUMA_B * qb
          const dl = lum - centerLum
          const w = spatial[(dy + r) * size + (dx + r)] * Math.exp(-(dl * dl) / twoSigma2)
          wSum += w
          accR += w * qr
          accG += w * qg
          accB += w * qb
        }
      }
      const k = Math.min(1, strength)
      out[p] = cr + (accR / wSum - cr) * k
      out[p + 1] = cg + (accG / wSum - cg) * k
      out[p + 2] = cb + (accB / wSum - cb) * k
      out[p + 3] = rgba[p + 3]
    }
  }
  return out
}

export function smoothScalarField(
  t: Float32Array,
  width: number,
  height: number,
  strength: number,
): Float32Array {
  const r = radiusOf(strength)
  if (r === 0 || width < 1 || height < 1) return t
  const out = new Float32Array(t.length)
  const size = 2 * r + 1
  const spatial = spatialWeights(r)
  const twoSigma2 = 2 * SIGMA_SCALAR * SIGMA_SCALAR
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const center = t[idx]
      let wSum = 0
      let acc = 0
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy))
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx))
          const v = t[yy * width + xx]
          const d = v - center
          const w = spatial[(dy + r) * size + (dx + r)] * Math.exp(-(d * d) / twoSigma2)
          wSum += w
          acc += w * v
        }
      }
      const k = Math.min(1, strength)
      out[idx] = center + (acc / wSum - center) * k
    }
  }
  return out
}

/**
 * Large-scale low-pass for the RELIEF map. Deliberately NOT edge-preserving:
 * for a printed bas-relief every photographic edge that survives into the
 * height map becomes a cliff ("himalayas") exactly where the picture has
 * detail. Detail belongs to the COLOR bands; the height should follow only
 * the large forms.
 *
 * Radius scales with the picture: ~1/18 of the larger side at strength 1
 * (a 150 mm print at 0.4 mm nozzle is ~375 px → radius ≈ 21 px ≈ 8 mm),
 * ramping linearly down to ~1/36 at half strength. Two box-blur passes
 * approximate a Gaussian — cheap and separable, and the printed surface
 * is re-snapped to the layer ladder afterwards anyway.
 */
export function reliefLowPassField(
  t: Float32Array,
  width: number,
  height: number,
  strength: number,
): Float32Array {
  const k = Math.min(1, Math.max(0, strength))
  if (k === 0 || width < 3 || height < 3) return t
  const large = Math.max(width, height)
  const radius = Math.max(2, Math.round((large / 36) * (0.5 + k)))
  const blurred = boxBlur2D(t, width, height, radius)

  // The blur alone would print a plate: `luminance` is read as a 0..1 relief
  // position, so a field squeezed into the middle of the range keeps its
  // shapes but loses its depth (a photo of a figure reads as flat terrain).
  // Restore the envelope the picture had — from robust percentiles, NOT from
  // min/max: min/max hands the scale back to the handful of residual pixel
  // outliers, which is exactly what used to bring the cliffs back. The
  // percentiles measure the large forms, so their span is the depth to keep.
  const [sourceLow, sourceHigh] = robustRange(t)
  const [blurredLow, blurredHigh] = robustRange(blurred)
  const blurredSpan = blurredHigh - blurredLow
  if (!(blurredSpan > 1e-6)) return blurred

  const scale = (sourceHigh - sourceLow) / blurredSpan
  const out = new Float32Array(blurred.length)
  for (let i = 0; i < out.length; i++) {
    const value = sourceLow + (blurred[i] - blurredLow) * scale
    out[i] = value < 0 ? 0 : value > 1 ? 1 : value
  }
  return out
}

/**
 * Robust `[low, high]` of a field: quantiles of a sampled copy, so the value
 * does not depend on the extremes. 2%..98% by default — wide enough to cover
 * the picture's real range, tight enough to ignore residual outliers.
 */
function robustRange(values: Float32Array, low = 0.02, high = 0.98): [number, number] {
  const step = Math.max(1, Math.floor(values.length / 100_000))
  const sample: number[] = []
  for (let i = 0; i < values.length; i += step) sample.push(values[i])
  sample.sort((a, b) => a - b)
  const at = (q: number) =>
    sample[Math.min(sample.length - 1, Math.max(0, Math.round(q * (sample.length - 1))))]
  return [at(low), at(high)]
}

/** Two separable box passes ≈ Gaussian; clamped edges, one O(n) sweep per axis. */
function boxBlur2D(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  boxBlurAxis(src, tmp, width, height, radius, true)
  boxBlurAxis(tmp, out, width, height, radius, false)
  return out
}

function boxBlurAxis(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
): void {
  const outer = horizontal ? height : width
  const inner = horizontal ? width : height
  const stride = horizontal ? 1 : width
  for (let o = 0; o < outer; o++) {
    const base = o * (horizontal ? width : 1)
    // Sliding window sum with clamped edges.
    let sum = 0
    for (let d = -radius; d <= radius; d++) {
      const i = Math.min(inner - 1, Math.max(0, d))
      sum += src[base + i * stride]
    }
    const norm = 2 * radius + 1
    for (let p = 0; p < inner; p++) {
      dst[base + p * stride] = sum / norm
      const outIdx = Math.min(inner - 1, Math.max(0, p - radius))
      const inIdx = Math.min(inner - 1, Math.max(0, p + radius + 1))
      sum += src[base + inIdx * stride] - src[base + outIdx * stride]
    }
  }
}
