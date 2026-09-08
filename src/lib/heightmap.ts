import type { HeightField, PrintSettings, QuantizedImage } from './types'

/**
 * Top of each height band in mm (bottom → top). Every internal band top is
 * snapped to the whole-layer grid of the chosen layer height so a tool change
 * always lands exactly on a slicer layer; the final band's top is the model's
 * top surface and is clamped to the user's max-height value exactly instead of
 * the grid-rounded value. Rounding can collide two boundaries (a band thinner
 * than half a layer), so tops are forced to stay strictly increasing, at
 * least one layer apart — in that degenerate case the final top overshoots
 * the max height rather than break monotonicity (exports filter such changes).
 */
export function snappedBandTops(image: QuantizedImage, settings: PrintSettings): number[] {
  const n = image.palette.length
  const usable = settings.maxHeightMm - settings.baseMm
  const layerMm = settings.layerMm
  const out: number[] = []
  // Custom per-band thicknesses (HueForge-style). The palette is sorted dark
  // → light, but stacking follows the depth mode: with darkIsTall the lightest
  // band prints first (bottom) and the darkest last (top). A band's top is the
  // base plus the cumulative thickness of every band below it plus its own.
  // The final top is the derived max height (base + Σh) exactly, so the model
  // top stays exactly at maxHeight even when the sum isn't a layer multiple.
  const custom = image.bandHeightsMm
  const hasCustom = !!custom && custom.length === n && custom.every((h) => Number.isFinite(h) && h > 0)
  const stackTop: number[] = []
  if (hasCustom) {
    let z = settings.baseMm
    for (let r = 0; r < n; r++) {
      // Stack position r (bottom → top) holds palette band n-1-r when the
      // dark colors print last, else palette band r.
      z += custom[settings.darkIsTall ? n - 1 - r : r]
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
 * Turn per-pixel band labels into a height field in mm.
 *
 * HueForge-style stepped geometry: every pixel of a color band stands at
 * exactly the top of its band — a flat-topped sheet — so the top surface of
 * the lightest band is perfectly smooth and each printed layer carries a
 * single color. Heights are the band tops snapped to the layer-height grid,
 * so the geometry agrees with the exported tool changes to the millimeter.
 */
export function buildHeightField(image: QuantizedImage, settings: PrintSettings): HeightField {
  const { width, height, indexMap, palette } = image
  const n = palette.length
  const tops = snappedBandTops(image, settings)
  const values = new Float32Array(width * height)
  for (let i = 0; i < values.length; i++) {
    const slice = settings.darkIsTall ? n - 1 - indexMap[i] : indexMap[i]
    values[i] = tops[Math.min(slice, tops.length - 1)]
  }
  return { width, height, values }
}
