import type { HeightField, PrintSettings, QuantizedImage } from './types'

/**
 * Top of each color sheet in mm (bottom → top).
 *
 * The schedule is separate from the image relief: color swaps happen at these
 * boundaries, while individual pixels may end anywhere inside a sheet. This
 * is the important distinction from a color-band heightmap — HueForge Standard
 * maps image brightness continuously to height, then the slicer resolves that
 * height on its layer grid.
 */
export function snappedBandTops(image: QuantizedImage, settings: PrintSettings): number[] {
  const n = image.palette.length
  const usable = settings.maxHeightMm - settings.baseMm
  const layerMm = settings.layerMm
  const out: number[] = []
  // Custom per-band thicknesses are indexed dark → light, while `b` is the
  // physical stack position bottom → top. With darkIsTall the lightest slot
  // is printed first; otherwise the darkest slot is printed first.
  const custom = image.bandHeightsMm
  const hasCustom = !!custom && custom.length === n && custom.every((h) => Number.isFinite(h) && h > 0)
  const stackTop: number[] = []
  if (hasCustom) {
    let z = settings.baseMm
    for (let b = 0; b < n; b++) {
      z += custom[settings.darkIsTall ? n - 1 - b : b]
      stackTop.push(z)
    }
  }

  for (let b = 0; b < n; b++) {
    const ideal = hasCustom ? stackTop[b] : settings.baseMm + usable * image.bandTops[b]
    const snapped = Math.round(ideal / layerMm) * layerMm
    const min = (out.length > 0 ? out[out.length - 1] : settings.baseMm) + layerMm
    const top = b === n - 1 ? settings.maxHeightMm : snapped
    out.push(Math.max(top, min))
  }
  return out
}

/**
 * Map one normalized relief position to a physical height.
 *
 * In Standard mode this is a continuous brightness → height mapping, snapped
 * only to the selected layer height. With custom per-color thicknesses the
 * same continuous position is distributed piecewise across the color sheets,
 * so custom sheet sizes still control the color-transition locations without
 * flattening all pixels in a sheet to one plateau.
 */
function reliefHeight(t: number, image: QuantizedImage, settings: PrintSettings, tops: number[]): number {
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0
  const base = settings.baseMm
  const max = settings.maxHeightMm
  const usable = Math.max(0, max - base)
  const n = image.palette.length
  const custom = image.bandHeightsMm
  const hasCustom = !!custom && custom.length === n && custom.every((h) => Number.isFinite(h) && h > 0)

  let z: number
  if (!hasCustom || usable <= 0 || tops.length === 0) {
    z = base + usable * clamped
  } else {
    // The piecewise anchors are the band boundaries in relief space (the
    // equal-population quantiles the color assignment used) paired with the
    // physical heights the custom thicknesses give those bands. Deriving the
    // fractions from the heights instead would let a pixel's surface leave its
    // own color band: a thick custom slice would push mid-band pixels past the
    // next band's top.
    const fractions = image.bandTops.length === tops.length
      ? image.bandTops.map((t) => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 1))
      : tops.map((top) => Math.min(1, Math.max(0, (top - base) / usable)))
    let band = 0
    while (band < fractions.length - 1 && clamped > fractions[band]) band++
    const loT = band === 0 ? 0 : fractions[band - 1]
    const hiT = Math.max(loT + 1e-9, fractions[band])
    const loZ = band === 0 ? base : tops[band - 1]
    const hiZ = tops[band]
    const local = Math.min(1, Math.max(0, (clamped - loT) / (hiT - loT)))
    z = loZ + (hiZ - loZ) * local
  }

  // HueForge meshes are evaluated on real print layers. Keeping this snap at
  // the final per-pixel value produces the many ~0.2 mm tonal steps visible in
  // the reference STL, rather than one step per palette color.
  const snapped = Math.round(z / settings.layerMm) * settings.layerMm
  return Math.min(max, Math.max(base, snapped))
}

/**
 * Turn the continuous per-pixel relief into a layer-resolved height field.
 *
 * `QuantizedImage.luminance` is the oriented 0..1 relief position (already
 * inverted when darkIsTall is enabled). `indexMap` remains the per-pixel
 * color/palette map for the image preview and face colors; it must not be used
 * as the geometry height because that collapses a tonal image into N flat
 * plateaus.
 */
export function buildHeightField(image: QuantizedImage, settings: PrintSettings): HeightField {
  const { width, height, palette } = image
  const tops = snappedBandTops(image, settings)
  const values = new Float32Array(width * height)
  const hasRelief = image.luminance.length === values.length
  for (let i = 0; i < values.length; i++) {
    const fallback = palette.length > 1
      ? image.indexMap[i] / Math.max(1, palette.length - 1)
      : 0
    const t = hasRelief ? image.luminance[i] : fallback
    values[i] = reliefHeight(t, image, settings, tops)
  }
  return { width, height, values }
}
