import { srgbToLab } from './deltae'
import { distinctPalette } from './quantize'
import type { RGB } from './types'

/** A color of the picture that no filament of the palette comes close to. */
export interface LostColor {
  color: RGB
  /** Share of the picture's pixels nearest to this color, 0..1. */
  share: number
}

/**
 * Colors the brightness model cannot print: the picture's distinct colors
 * (as the colors-first model would pick them) that cover a visible part of
 * the picture yet sit far from every filament of `palette`.
 *
 * In the brightness model one brightness is one filament, so a red suit at
 * the brightness of a teal sky prints teal — the model is right to do so, but
 * the user should learn that «Colors from the picture» keeps it. Sorted by
 * share, largest first; empty when the palette already covers the picture.
 */
export function lostColors(
  rgba: Uint8ClampedArray,
  palette: RGB[],
  opts: { candidates?: number; minShare?: number; minDeltaE?: number } = {},
): LostColor[] {
  const pixelCount = rgba.length / 4
  if (pixelCount === 0 || palette.length === 0) return []
  const candidates = distinctPalette(rgba, opts.candidates ?? 8)
  const minShare = opts.minShare ?? 0.03
  const minDeltaE = opts.minDeltaE ?? 30

  // Each pixel votes for its nearest candidate (sampled for speed).
  const votes = new Uint32Array(candidates.length)
  const step = Math.max(1, Math.floor(pixelCount / 40000))
  let sampled = 0
  for (let i = 0; i < pixelCount; i += step) {
    const p = i * 4
    let best = 0
    let bestD = Infinity
    for (let k = 0; k < candidates.length; k++) {
      const c = candidates[k]!
      const d = (rgba[p]! - c.r) ** 2 + (rgba[p + 1]! - c.g) ** 2 + (rgba[p + 2]! - c.b) ** 2
      if (d < bestD) {
        bestD = d
        best = k
      }
    }
    votes[best]++
    sampled++
  }

  const paletteLab = palette.map((c) => srgbToLab(c.r, c.g, c.b))
  const lost: LostColor[] = []
  candidates.forEach((color, k) => {
    const share = votes[k]! / sampled
    if (share < minShare) return
    const [L, a, b] = srgbToLab(color.r, color.g, color.b)
    const nearest = Math.min(...paletteLab.map((q) => Math.hypot(L - q[0], a - q[1], b - q[2])))
    if (nearest >= minDeltaE) lost.push({ color, share })
  })
  return lost.sort((x, y) => y.share - x.share)
}
