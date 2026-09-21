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
 */

/** Kernel radius in cells for a strength value (0 → 0, 1 → 3). */
function radiusOf(strength: number): number {
  if (!(strength > 0)) return 0
  return Math.min(3, Math.max(1, Math.round(strength * 3)))
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
