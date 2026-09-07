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
