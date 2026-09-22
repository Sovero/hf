/** Shared print-geometry constants, owned here so every consumer agrees. */

/** Typical FDM nozzle diameter (mm). */
export const NOZZLE_MM = 0.4

/**
 * Working-resolution fit: the decode cap bounding memory/CPU. The pipeline
 * prints the image at `widthMm × heightMm`; a cell is `sizeMm / pixels`, so
 * the nozzle-exact pixel budget per axis is `sizeMm / NOZZLE_MM` (150 mm →
 * 375 px, 200 mm → 500 px). The 1024 px cap keeps prints up to ~409 mm at
 * nozzle-exact resolution and still yields sub-nozzle cells beyond that —
 * finer cells sharpen the on-screen previews and let dithering form smoother
 * tonal transitions, while the mesh merger keeps STL size in check.
 */
export const MAX_DIMENSION = 1024

/** Pixels per axis for a print size so each cell ≥ one nozzle width. */
export function fitResolution(sizeMm: number): number {
  return Math.max(16, Math.min(MAX_DIMENSION, Math.floor(sizeMm / NOZZLE_MM)))
}

/**
 * Smallest fraction of the usable height a single color band may occupy.
 *
 * A band thinner than the nozzle is one smeared layer: the print preview —
 * which models the filaments as translucent sheets — shows it as almost fully
 * transparent, so that filament's color all but vanishes and its area washes
 * into the color printed below it. The tone curve (contrast / power) moves the
 * band tops with the relief, so a strong preset can squeeze the bottom bands
 * into exactly that state; this floor is what keeps a look choice from
 * producing a model the printability check flags as unfixable-by-looks.
 *
 * The floor is the nozzle width plus one layer of headroom, because
 * `snappedBandTops` rounds the band tops onto the layer grid and could
 * otherwise shave a band back under the nozzle. Capped at 1/n: when the height
 * cannot carry n printable bands, the floor can only divide it evenly.
 */
export function minBandFraction(numColors: number, usableMm: number, layerMm = 0.2): number {
  const n = Math.max(1, Math.floor(numColors))
  if (!(usableMm > 0)) return 0
  const layer = Number.isFinite(layerMm) && layerMm > 0 ? layerMm : 0.2
  return Math.min(1 / n, (NOZZLE_MM + layer) / usableMm)
}

/**
 * Largest height change allowed between neighbouring cells, in relief units
 * (fraction of the usable height).
 *
 * Two layers of filament per cell is a 45° face at the nozzle-exact cell size —
 * the steepest overhang FDM prints without support, so the surface keeps its
 * shape while never growing a vertical cliff. The color-first model turns every
 * colour boundary into a height step, and without this limit a detailed picture
 * prints as a picket fence of fins: a 1.2 mm step then spreads over three cells
 * instead, i.e. a compact shoulder.
 */
export function maxReliefStep(usableMm: number, layerMm = 0.2): number {
  const layer = Number.isFinite(layerMm) && layerMm > 0 ? layerMm : 0.2
  if (!(usableMm > 0)) return (2 * layer) / 7.2
  return Math.min(0.5, (2 * layer) / usableMm)
}

/**
 * Fit the print size to an image's aspect ratio: the larger print side is
 * preserved, the other scales to the picture's proportions (rounded to
 * 0.1 mm, clamped to the 20–500 mm input range). Used when a new image is
 * loaded so the print never distorts the source; degenerate input falls
 * back to the current size.
 */
export function fitPrintSizeToAspect(
  srcW: number,
  srcH: number,
  curW: number,
  curH: number,
  minMm = 20,
  maxMm = 500,
): { widthMm: number; heightMm: number } {
  if (!(srcW > 0) || !(srcH > 0)) return { widthMm: curW, heightMm: curH }
  const aspect = srcW / srcH
  let w: number
  let h: number
  if (curW >= curH) {
    w = curW
    h = w / aspect
  } else {
    h = curH
    w = h * aspect
  }
  // Respect the caps; if one side clamps, pull the other back to keep shape.
  if (w > maxMm) {
    w = maxMm
    h = w / aspect
  }
  if (h > maxMm) {
    h = maxMm
    w = h * aspect
  }
  if (w < minMm) {
    w = minMm
    h = w / aspect
  }
  if (h < minMm) {
    h = minMm
    w = h * aspect
  }
  const round = (v: number) => Math.round(Math.min(maxMm, Math.max(minMm, v)) * 10) / 10
  return { widthMm: round(w), heightMm: round(h) }
}
