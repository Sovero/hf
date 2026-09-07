import type { PipelineResult } from './pipeline'
import { snappedBandTops } from './heightmap'
import { columnColor } from './transmission'

export interface LayerViewResult {
  /** RGBA pixels (row-major) of the print at height z, ready for ImageData. */
  rgba: Uint8ClampedArray<ArrayBuffer>
  /** Index into `result.quantized.palette` of the band being printed at z. */
  activeBand: number
  /** 1-indexed slicer layer containing z (clamped to the layer count). */
  layer: number
  /** Total number of printed layers at the chosen layer height. */
  totalLayers: number
}

/**
 * What a single printed layer at height z looks like, with translucent
 * filament optics.
 *
 * At print time (mid-print) you see freshly-extruded opaque-ish plastic, so
 * growing columns show the color being printed and finished columns show a
 * translucent blend of their whole sheet stack (the physical look of the
 * finished print). At the model top every column shows its transmitted blend —
 * the true HueForge appearance, where thin top sheets let the layers below
 * shine through.
 *
 * Band tops come from `snappedBandTops`, the same values that drive the mesh
 * and the swap schedule, so the view can never disagree with exports.
 */
export function layerView(result: PipelineResult, zMm: number): LayerViewResult {
  const { quantized, settings } = result
  const { width, height, indexMap, palette } = quantized
  const n = palette.length
  const tops = snappedBandTops(quantized, settings)

  const eps = 1e-9
  const z = Math.min(Math.max(zMm, 0), settings.maxHeightMm)
  // Band printed at z: first band whose top reaches z (its top surface is
  // exactly z means this layer is that band's last one).
  let activeBand = n - 1
  for (let b = 0; b < n; b++) {
    if (tops[b] >= z - eps) {
      activeBand = b
      break
    }
  }
  const bandColor = palette[settings.darkIsTall ? n - 1 - activeBand : activeBand]

  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const slice = settings.darkIsTall ? n - 1 - indexMap[i] : indexMap[i]
    const columnTop = tops[Math.min(slice, n - 1)]
    const c = columnTop <= z + eps ? columnColor(result, columnTop) : bandColor
    rgba[i * 4] = Math.round(c.r)
    rgba[i * 4 + 1] = Math.round(c.g)
    rgba[i * 4 + 2] = Math.round(c.b)
    rgba[i * 4 + 3] = 255
  }

  const layer = Math.min(Math.max(Math.round(z / settings.layerMm), 1), Math.max(1, Math.round(settings.maxHeightMm / settings.layerMm)))
  return { rgba, activeBand, layer, totalLayers: Math.max(1, Math.round(settings.maxHeightMm / settings.layerMm)) }
}
