import type { HeightField, PrintSettings, QuantizedImage } from './types'

/**
 * Turn palette indices into per-pixel heights (mm).
 *
 * Palette is ordered darkest → lightest (index 0 = darkest).
 * With darkIsTall, the darkest color is the tallest band (printed last,
 * on top — classic HueForge). With lightIsTall (darkIsTall=false), the
 * lightest color is tallest.
 */
export function buildHeightField(image: QuantizedImage, settings: PrintSettings): HeightField {
  const n = image.palette.length
  const usable = settings.maxHeightMm - settings.baseMm
  const step = n > 1 ? usable / (n - 1) : 0
  const values = new Float32Array(image.width * image.height)

  for (let i = 0; i < values.length; i++) {
    const idx = image.indexMap[i]
    const band = settings.darkIsTall ? n - 1 - idx : idx
    values[i] = settings.baseMm + band * step
  }

  return { width: image.width, height: image.height, values }
}