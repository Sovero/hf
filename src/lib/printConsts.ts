/** Shared print-geometry constants, owned here so every consumer agrees. */

/** Typical FDM nozzle diameter (mm). */
export const NOZZLE_MM = 0.4

/**
 * Working-resolution fit: the decode cap that keeps each image cell at or
 * above the nozzle width. The pipeline prints the image at `widthMm ×
 * heightMm`; a cell is `sizeMm / pixels`, so the pixel budget per axis is
 * `sizeMm / NOZZLE_MM` (150 mm → 375 px, 200 mm → 500 px). The 512 px
 * absolute cap bounds memory/CPU; below 512 px, size-fit resolution makes
 * detail nozzle-sized instead of structurally sub-nozzle.
 */
export const MAX_DIMENSION = 512

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
