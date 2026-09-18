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
