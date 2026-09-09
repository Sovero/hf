import type { PipelineResult } from './pipeline'
import type { RGB } from './types'
import { snappedBandTops } from './heightmap'

/**
 * Light-transmission model for translucent filament.
 *
 * A HueForge print is a stack of translucent sheets: light penetrates the top
 * layers, reflects off whatever is below, and the *visible* color of a pixel
 * is a blend of the whole column — not just its top band. Thin top color →
 * mostly shows what's underneath; a thick top color covers it.
 *
 * We model each filament sheet with a single "coverage after thickness z"
 * curve: T(z) = 1 − e^(−z/τ), where τ (tau) is the filament's opacity length
 * in mm — the thickness at which the sheet hides ~63% of what's below. A
 * pixel's visible color is computed by stacking from the bottom:
 *
 *   shown = blend of all sheets, weighted by how much light each still lets
 *   through: each sheet i multiplies the remaining see-through by (1 − T(h_i))
 *   and contributes its own color with weight T(h_i).
 *
 * The base slab is opaque (it's the backdrop, usually the first color).
 *
 * τ is PER FILAMENT: real spools differ wildly (white PLA is nearly opaque,
 * black transmits strongly). It lives on `quantized.tauMm` (indexed like the
 * palette) and can be fitted from a printed calibration swatch — see
 * lib/calibration.ts. Unknown/invalid values fall back to the default.
 */

/** Default per-filament opacity length τ (mm): thickness at which T(z) ≈ 63%. */
export const DEFAULT_TAU_MM = 1.2

/**
 * Sheet thicknesses from each filament's τ, HueForge-TD-style.
 *
 * A sheet must be thick enough that what's below no longer shows through:
 * covering fraction is T(t) = 1 − e^(−t/τ), so reaching `opacity` needs
 * t = −ln(1−opacity)·τ — transparent filaments (high τ) get thick sheets,
 * opaque ones get thin ones. The raw needs are scaled so the sheets sum to
 * `usableMm` exactly (the model still tops out at max-height), and any sheet
 * that would fall below `minMm` is pinned there while the leftover is
 * redistributed among the rest.
 */
export function tauBandHeights(
  taus: number[],
  opts: { usableMm: number; minMm?: number; opacity?: number } = { usableMm: 0 },
): number[] {
  const n = taus.length
  if (n === 0) return []
  const usable = Math.max(0, opts.usableMm)
  const minMm = opts.minMm ?? 0.4
  if (usable < n * minMm) {
    // Not enough room to keep even minMm per sheet: split what's left evenly.
    const share = usable / n
    return new Array<number>(n).fill(share)
  }
  const target = opts.opacity ?? 0.9
  const k = -Math.log(1 - target) // ≈ 2.303 for 90%
  const raw = taus.map((tau) =>
    Math.max(minMm, k * (Number.isFinite(tau) && tau > 0 ? tau : DEFAULT_TAU_MM)),
  )
  const out = new Array<number>(n).fill(0)
  let remaining = usable
  let active = raw.map((_, i) => i)
  while (active.length > 0) {
    const total = active.reduce((a, i) => a + raw[i], 0)
    if (total <= 0) break
    const scale = remaining / total
    const violators = active.filter((i) => raw[i] * scale < minMm)
    if (violators.length === 0) {
      for (const i of active) out[i] = raw[i] * scale
      break
    }
    for (const i of violators) {
      out[i] = minMm
      remaining -= minMm
    }
    active = active.filter((i) => !violators.includes(i))
  }
  return out
}

/** Transmission of a sheet of thickness zMm (0..1 of what it hides). */
export function transmission(zMm: number, tauMm: number = DEFAULT_TAU_MM): number {
  if (zMm <= 0) return 0
  return 1 - Math.exp(-zMm / tauMm)
}

/** τ of print slice k (bottom → top), read from the palette's per-slot tauMm. */
function sheetTau(result: PipelineResult, k: number): number {
  const n = result.quantized.palette.length
  const slot = result.settings.darkIsTall ? n - 1 - k : k
  const tau = result.quantized.tauMm?.[slot]
  return typeof tau === 'number' && Number.isFinite(tau) && tau > 0 ? tau : DEFAULT_TAU_MM
}

/**
 * Blend a sheet stack bottom → top: the bottom sheet lies on the opaque base
 * and shows itself fully; each higher translucent sheet covers the result
 * below it in proportion to its transmission at its own thickness.
 */
function stackSheets(sheets: { color: RGB; thickness: number; tau: number }[]): RGB {
  let shown = sheets[0].color
  for (let k = 1; k < sheets.length; k++) {
    const t = transmission(sheets[k].thickness, sheets[k].tau)
    const c = sheets[k].color
    shown = {
      r: c.r * t + shown.r * (1 - t),
      g: c.g * t + shown.g * (1 - t),
      b: c.b * t + shown.b * (1 - t),
    }
  }
  return shown
}

/**
 * Visible color of one pixel column, blending all filament sheets below the
 * column top with transmission weights (per-sheet τ).
 *
 * `columnTopZMm` — the z the column was printed to. Sheets thinner than that
 * all contribute; the bottom-most sheet is treated as opaque backdrop (the
 * print sits on it), so the result is well-defined even for a 1-band image.
 */
export function columnColor(
  result: PipelineResult,
  columnTopZMm: number,
): RGB {
  const { settings, quantized } = result
  const n = quantized.palette.length
  const tops = snappedBandTops(quantized, settings)

  // Sheets below the column top, bottom → top, with their thicknesses.
  // Sheet k spans (prevTop..tops[k]); the base slab (0..baseMm) is opaque.
  let base = settings.baseMm
  const sheets: { color: RGB; thickness: number; tau: number }[] = []
  for (let k = 0; k < n; k++) {
    const top = tops[k]
    if (top <= base + 1e-9) continue
    const thickness = Math.min(top, columnTopZMm) - base
    if (thickness <= 0) break
    sheets.push({ color: sliceColor(result, k), thickness, tau: sheetTau(result, k) })
    base = top
    if (top >= columnTopZMm - 1e-9) break
  }
  if (sheets.length === 0) {
    sheets.push({
      color: sliceColor(result, 0),
      thickness: Math.max(0.1, columnTopZMm - settings.baseMm),
      tau: sheetTau(result, 0),
    })
  }
  return stackSheets(sheets)
}

/**
 * Transmitted (finished-print) color of every band, indexed bottom → top by
 * print slice. A column's appearance depends only on which band tops it, so
 * previews look these n colors up instead of re-stacking sheets per pixel.
 */
export function transmittedBandColors(result: PipelineResult): RGB[] {
  const tops = snappedBandTops(result.quantized, result.settings)
  return tops.map((top) => columnColor(result, top))
}

/**
 * Backlight viewing: the print lit from behind, transmission only.
 *
 * Front-lit viewing stacks translucent sheets over an *opaque* backdrop (the
 * base slab / wall). Backlight inverts the situation: light enters from
 * behind and passes through the whole stack — every sheet attenuates and
 * tints it, and the base slab participates too (it is no longer an opaque
 * backdrop, just another sheet). Dark filaments act like filters, so thin
 * dark areas glow with the light leaking through — the signature backlit
 * look of HueForge wall art hung over a lamp or window.
 *
 * Physics: incident white light, per channel, is folded through the sheets
 * bottom → top. Sheet k transmits a fraction (1 − T(z_k)) of what reaches it
 * and tints it toward its pigment: `out = c·T + out·(1 − T)`. This is the
 * same blend algebra as the front-lit stack but with **no opaque floor** —
 * the stack starts from white instead, and the base slab participates as
 * sheet 0. Order is not free: each sheet filters the light that has already
 * passed through the sheets below it, so the fold must run bottom → top.
 */
export function backlitColumnColor(result: PipelineResult, columnTopZMm: number): RGB {
  const { settings, quantized } = result
  const n = quantized.palette.length
  const tops = snappedBandTops(quantized, settings)

  // Fold incident white light through every sheet below the column top,
  // bottom → top. The base slab (0..baseMm) is printed in the first color
  // (slice 0 owns 0..tops[0]), so it joins the stack as sheet 0 with its own
  // τ — in backlight it attenuates and tints like any other sheet.
  let out = { r: 255, g: 255, b: 255 }
  let base = 0 // backlight fold starts from the bed: the slab is a sheet
  for (let k = 0; k < n; k++) {
    const top = tops[k]
    if (top <= base + 1e-9) continue
    const thickness = Math.min(top, columnTopZMm) - base
    if (thickness <= 0) break
    const tau = sheetTau(result, k)
    const t = transmission(thickness, tau)
    const c = sliceColor(result, k)
    out = {
      r: c.r * t + out.r * (1 - t),
      g: c.g * t + out.g * (1 - t),
      b: c.b * t + out.b * (1 - t),
    }
    base = top
    if (top >= columnTopZMm - 1e-9) break
  }
  return out
}

/**
 * Backlit color of every band, indexed bottom → top by print slice — the
 * backlight-mode lookup table for previews, mirroring transmittedBandColors.
 */
export function backlitBandColors(result: PipelineResult): RGB[] {
  const tops = snappedBandTops(result.quantized, result.settings)
  return tops.map((top) => backlitColumnColor(result, top))
}

/** Palette RGB of print slice k (0 = bottom/first-printed). */
function sliceColor(result: PipelineResult, k: number): RGB {
  const n = result.quantized.palette.length
  return result.quantized.palette[result.settings.darkIsTall ? n - 1 - k : k]
}
