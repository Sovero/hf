import type { PipelineResult } from './pipeline'
import { nearestFilament, rgbToHex } from './palette'

const fmt = (v: number) => v.toFixed(2)
/** 1-indexed layer containing height z at the chosen layer height. */
const layerAt = (z: number, layerMm: number) => Math.max(1, Math.round(z / layerMm))

/**
 * HueForge-style companion text (Describe.txt): documents how to print the
 * exported model with the chosen layer height — the filament order from the
 * base up and the exact layer at which to swap each filament. Bands are
 * listed bottom → top regardless of the depth mode, and each swap lands on
 * the whole layer nearest the band boundary, so a printed layer never mixes
 * two colors.
 */
export function describeExport(result: PipelineResult, name: string): string {
  const { palette, settings } = result
  const n = palette.length
  const { baseMm, maxHeightMm, widthMm, heightMm, layerMm, darkIsTall } = settings

  // Bottom → top: ascending band tops. Each filament owns one contiguous
  // height block, so the next band's bottom is this band's top.
  const bands = [...palette].sort((a, b) => a.topZMm - b.topZMm)
  const totalLayers = layerAt(maxHeightMm, layerMm)
  // Display ranges never leave the model's footprint (grid snapping can push
  // a band top past the max height when bands are thinner than half a layer).
  const clampZ = (z: number) => Math.min(Math.max(z, baseMm), maxHeightMm)

  const lines: string[] = []
  lines.push('==============================================')
  lines.push(`HueForge Web — ${name}`)
  lines.push('==============================================')
  lines.push(`Model size: ${fmt(widthMm)} x ${fmt(heightMm)} mm`)
  lines.push(`Base: ${fmt(baseMm)} mm · max height: ${fmt(maxHeightMm)} mm`)
  lines.push(`Layer height: ${fmt(layerMm)} mm (${totalLayers} layers)`)
  lines.push(
    `Depth mode: ${darkIsTall ? 'dark image areas stand tallest' : 'bright image areas stand tallest'}`,
  )
  lines.push('')
  lines.push('Filaments, bottom → top:')
  bands.forEach((entry, i) => {
    const bottomZ = clampZ(i === 0 ? baseMm : bands[i - 1].topZMm)
    const topZ = clampZ(i === n - 1 ? maxHeightMm : entry.topZMm)
    lines.push(
      `  ${entry.printOrder}. ${rgbToHex(entry.color)} · ${nearestFilament(entry.color, 'en')}` +
        ` · height ${fmt(bottomZ)}–${fmt(topZ)} mm` +
        ` · layers ${layerAt(bottomZ, layerMm)}–${Math.min(layerAt(topZ, layerMm), totalLayers)}`,
    )
  })
  lines.push('')
  lines.push('Color swap schedule — change filament at the start of these layers:')
  for (let i = 0; i < bands.length - 1; i++) {
    const z = bands[i].topZMm
    if (z >= maxHeightMm - 1e-9) continue // nothing prints above the model top
    const layer = Math.min(layerAt(z, layerMm), totalLayers)
    const next = bands[i + 1]
    lines.push(
      `  Layer ${layer} (z = ${fmt(z)} mm): switch to ${rgbToHex(next.color)} · ${nearestFilament(next.color, 'en')}`,
    )
  }
  lines.push('')
  return lines.join('\n')
}