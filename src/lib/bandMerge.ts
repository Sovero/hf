import type { RGB } from './types'

/**
 * Merge adjacent palette bands whose colors are perceptually closer than a
 * ΔE threshold — near-duplicate spools cost a filament swap but add nothing
 * visible. The merged band's pixels are remapped to the survivor; the
 * survivor keeps its own color (physical filament), and the removed slots
 * disappear from the palette.
 *
 * ΔE here is the CIE76 distance in CIE L*a*b* — simple, symmetric, and close
 * enough for a "these two filaments look the same" judgment at the classic
 * thresholds (ΔE 76 ≈ 2.3 is a just-noticeable difference; 10+ is clearly
 * different at a glance).
 */

/** sRGB (0..255) → CIE L*a*b* (D65). Small, dependency-free. */
export function rgbToLab(c: RGB): [number, number, number] {
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const r = lin(c.r)
  const g = lin(c.g)
  const b = lin(c.b)
  // sRGB → XYZ (D65).
  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175
  const z = r * 0.0193339 + g * 0.119192 + b * 0.9503041
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x / 0.95047)
  const fy = f(y / 1.0)
  const fz = f(z / 1.08883)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIE76 perceptual distance between two RGB colors. */
export function deltaE(a: RGB, b: RGB): number {
  const [l1, a1, b1] = rgbToLab(a)
  const [l2, a2, b2] = rgbToLab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/**
 * Which palette slots survive a merge: slot i is dropped when it is
 * perceptually closer than `threshold` ΔE to a *kept* neighbor slot
 * (the nearest one — merging into the nearest neighbor keeps the visual
 * result closest to the original). Returns the survivor index for every
 * original slot (a mapping over palette indexes; dropped slots point at
 * the neighbor that absorbed them).
 */
export function mergeMap(palette: RGB[], threshold: number): number[] {
  const n = palette.length
  const target = Array.from({ length: n }, (_, i) => i)
  if (n < 3 || !(threshold > 0)) return target

  // Scan adjacent pairs in palette order (dark → light); a slot is dropped
  // into its neighbor if their ΔE is under the threshold. To keep survivors'
  // colors from drifting far, always compare against the *kept* color.
  let kept = 0
  for (let i = 1; i < n; i++) {
    if (deltaE(palette[kept], palette[i]) < threshold) {
      target[i] = kept
    } else {
      kept = i
    }
  }
  return target
}

/**
 * Apply a merge to a quantized image's label map: returns the remapped
 * labels (values < old n) and the list of kept palette indexes (dark →
 * light order preserved). `map[i]` is the surviving palette index for the
 * old slot i (identity for kept slots).
 */
export function applyMerge(
  indexMap: Uint8Array,
  map: number[],
): { indexMap: Uint8Array; kept: number[] } {
  const kept: number[] = []
  for (let i = 0; i < map.length; i++) if (map[i] === i) kept.push(i)
  const remap = new Uint8Array(map.length)
  for (let i = 0; i < map.length; i++) remap[i] = kept.indexOf(map[i])
  const out = new Uint8Array(indexMap.length)
  for (let i = 0; i < indexMap.length; i++) out[i] = remap[indexMap[i]]
  return { indexMap: out, kept }
}
