import type { HeightField, PrintSettings, QuantizedImage } from './types'

/**
 * Turn per-pixel relief positions into a height field in mm.
 *
 * `QuantizedImage.luminance` already holds a normalized 0..1 relief position
 * per pixel (0 = printed first, at the base; 1 = tallest, printed last),
 * derived from image brightness. This maps it linearly into the print height
 * range, producing a smooth brightness relief — exactly the way a HueForge
 * style model encodes an image: darker image areas sit lower, brighter ones
 * rise, and the filament color of each pixel is decided by the height band
 * its column reaches (so every printed layer has a single color).
 */
export function buildHeightField(image: QuantizedImage, settings: PrintSettings): HeightField {
  const { width, height, luminance } = image
  const usable = settings.maxHeightMm - settings.baseMm
  const values = new Float32Array(width * height)

  for (let i = 0; i < values.length; i++) {
    const t = luminance[i]
    values[i] = settings.baseMm + usable * (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0)
  }

  return { width, height, values }
}
