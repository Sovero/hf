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
 */

/** Per-filament opacity length τ (mm): thickness at which T(z) ≈ 63%. */
const TAU_MM = 1.2

/** Transmission of a sheet of thickness zMm (0..1 of what it hides). */
export function transmission(zMm: number, tauMm = TAU_MM): number {
  if (zMm <= 0) return 0
  return 1 - Math.exp(-zMm / tauMm)
}

/**
 * Visible color of one pixel column, blending all filament sheets below the
 * column top with transmission weights.
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
  const sheets: { color: RGB; thickness: number }[] = []
  for (let k = 0; k < n; k++) {
    const top = tops[k]
    if (top <= base + 1e-9) continue
    const thickness = Math.min(top, columnTopZMm) - base
    if (thickness <= 0) break
    sheets.push({ color: sliceColor(result, k), thickness })
    base = top
    if (top >= columnTopZMm - 1e-9) break
  }
  if (sheets.length === 0) sheets.push({ color: sliceColor(result, 0), thickness: Math.max(0.1, columnTopZMm - settings.baseMm) })

  // Stack from the bottom up. The first (bottom) sheet lies on the opaque
  // base slab, so start with its color fully shown, then let each higher
  // translucent sheet cover the previous result proportionally.
  let shown = sheets[0].color
  for (let k = 1; k < sheets.length; k++) {
    const t = transmission(sheets[k].thickness)
    const c = sheets[k].color
    shown = {
      r: c.r * t + shown.r * (1 - t),
      g: c.g * t + shown.g * (1 - t),
      b: c.b * t + shown.b * (1 - t),
    }
  }
  return shown
}

/** Palette RGB of print slice k (0 = bottom/first-printed). */
function sliceColor(result: PipelineResult, k: number): RGB {
  const n = result.quantized.palette.length
  return result.quantized.palette[result.settings.darkIsTall ? n - 1 - k : k]
}
