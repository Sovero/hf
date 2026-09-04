import type { PipelineResult } from './pipeline'
import { t, word, mmOf, type Lang } from '../i18n'

export type CheckLevel = 'ok' | 'warn' | 'fail'

export interface PrintabilityCheck {
  id: string
  level: CheckLevel
  title: string
  detail: string
}

export interface PrintabilityReport {
  checks: PrintabilityCheck[]
  errors: number
  warnings: number
}

/** Typical FDM layer height (mm). */
const LAYER_MM = 0.2
/** Typical nozzle diameter (mm). */
const NOZZLE_MM = 0.4
/** A connected region smaller than 3×3 cells counts as a fragile speck. */
const MIN_COMPONENT_CELLS = 9
/** Warn when at least this many specks appear. */
const MIN_SPECKS = 5
/** ...or when specks cover this fraction of the image. */
const MIN_SPECK_FRACTION = 0.005
/** Warn when the print needs this many filament changes. */
const MIN_SWAPS_WARN = 12

/**
 * Analyze a finished pipeline result for 3D-printability concerns.
 *
 * The geometry is a per-column relief: every column is solid from the base up
 * and all walls are vertical (≤90°), so higher layers always rest on material
 * below — true overhangs cannot occur and supports are never needed. The real
 * risks are thin color bands, feature resolution vs the nozzle, the number of
 * manual filament changes, and fragile isolated regions.
 */
export function analyzePrintability(result: PipelineResult, lang: Lang = 'en'): PrintabilityReport {
  const checks: PrintabilityCheck[] = []

  // ---- Geometry facts derived from the result itself ----
  const n = result.quantized.palette.length
  let maxH = 0
  let minH = Infinity
  const values = result.field.values
  for (let i = 0; i < values.length; i++) {
    if (values[i] > maxH) maxH = values[i]
    if (values[i] < minH) minH = values[i]
  }
  let widthMm = 0
  let heightMm = 0
  const pos = result.mesh.positions
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] > widthMm) widthMm = pos[i]
    if (pos[i + 1] > heightMm) heightMm = pos[i + 1]
  }

  // Each filament band owns 1/N of the relief height (base..max).
  const bandMm = n > 1 ? (maxH - minH) / n : maxH - minH
  const layersPerBand = bandMm / LAYER_MM
  const totalLayers = maxH / LAYER_MM
  const swaps = n - 1
  // Finest resolvable detail is limited by the finer axis: if either axis
  // produces cells below the nozzle width, detail on that axis will smear.
  const cellMm = Math.min(widthMm / result.image.width, heightMm / result.image.height)

  const str = (key: string, params?: Record<string, string>) => t(lang, key, params)
  const mm = (v: number) => mmOf(lang, v)
  const layersText = (v: number) => word(lang, Math.round(v * 10) / 10, 'layers')
  const colorsText = (v: number) => word(lang, v, 'colors')
  const swapsText = (v: number) => word(lang, v, 'swaps')
  const regionsText = (v: number) => word(lang, v, 'regions')

  // ---- 1. Color band thickness ----
  if (bandMm < LAYER_MM) {
    checks.push({
      id: 'bands',
      level: 'fail',
      title: str('pbBandsTitleFail'),
      detail: str('pbBandsDetailFail', { band: mm(bandMm), layer: mm(LAYER_MM) }),
    })
  } else if (bandMm < NOZZLE_MM) {
    checks.push({
      id: 'bands',
      level: 'warn',
      title: str('pbBandsTitleWarn'),
      detail: str('pbBandsDetailWarn', {
        band: mm(bandMm),
        layersText: layersText(layersPerBand),
        layer: mm(LAYER_MM),
        nozzle: mm(NOZZLE_MM),
      }),
    })
  } else {
    checks.push({
      id: 'bands',
      level: 'ok',
      title: str('pbBandsTitleOk'),
      detail: str('pbBandsDetailOk', {
        band: mm(bandMm),
        layersText: layersText(layersPerBand),
        layer: mm(LAYER_MM),
      }),
    })
  }

  // ---- 2. Feature resolution vs nozzle ----
  if (cellMm < LAYER_MM) {
    checks.push({
      id: 'resolution',
      level: 'fail',
      title: str('pbResTitleFail'),
      detail: str('pbResDetailFail', { cell: mm(cellMm), layer: mm(LAYER_MM) }),
    })
  } else if (cellMm < NOZZLE_MM) {
    checks.push({
      id: 'resolution',
      level: 'warn',
      title: str('pbResTitleWarn'),
      detail: str('pbResDetailWarn', { cell: mm(cellMm), nozzle: mm(NOZZLE_MM) }),
    })
  } else {
    checks.push({
      id: 'resolution',
      level: 'ok',
      title: str('pbResTitleOk'),
      detail: str('pbResDetailOk', { cell: mm(cellMm), nozzle: mm(NOZZLE_MM) }),
    })
  }

  // ---- 3. Filament changes (layer count vs manual work) ----
  if (swaps >= MIN_SWAPS_WARN) {
    checks.push({
      id: 'swaps',
      level: 'warn',
      title: str('pbSwapsTitleWarn'),
      detail: str('pbSwapsDetailWarn', {
        colorsText: colorsText(n),
        swapsText: swapsText(swaps),
        layersText: layersText(Math.round(totalLayers)),
      }),
    })
  } else {
    checks.push({
      id: 'swaps',
      level: 'ok',
      title: str('pbSwapsTitleOk'),
      detail: str('pbSwapsDetailOk', {
        colorsText: colorsText(n),
        swapsText: swapsText(swaps),
        layersText: layersText(Math.round(totalLayers)),
      }),
    })
  }

  // ---- 4. Support & overhang risk (isolated fragile regions) ----
  const { specks, speckCells } = findIsolatedRegions(result.quantized.indexMap, result.image.width, result.image.height)
  const fraction = speckCells / (result.image.width * result.image.height)
  if (specks >= MIN_SPECKS || fraction >= MIN_SPECK_FRACTION) {
    checks.push({
      id: 'support',
      level: 'warn',
      title: str('pbSupportTitleWarn'),
      detail: str('pbSupportDetailWarn', {
        regionsText: regionsText(specks),
        fraction: (fraction * 100).toFixed(1),
      }),
    })
  } else {
    checks.push({
      id: 'support',
      level: 'ok',
      title: str('pbSupportTitleOk'),
      detail: str('pbSupportDetailOk'),
    })
  }

  const errors = checks.filter((c) => c.level === 'fail').length
  const warnings = checks.filter((c) => c.level === 'warn').length
  return { checks, errors, warnings }
}

/**
 * Count connected same-color regions smaller than MIN_COMPONENT_CELLS cells
 * (4-connectivity). These are quantization speckles / tiny islands that print
 * poorly — the closest this geometry comes to "unsupported" features.
 */
function findIsolatedRegions(indexMap: Uint8Array, width: number, height: number): { specks: number; speckCells: number } {
  const total = width * height
  const visited = new Uint8Array(total)
  const stack: number[] = []
  let specks = 0
  let speckCells = 0

  for (let start = 0; start < total; start++) {
    if (visited[start]) continue
    const color = indexMap[start]
    let size = 0
    stack.length = 0
    stack.push(start)
    visited[start] = 1
    while (stack.length > 0) {
      const p = stack.pop()!
      size++
      const x = p % width
      if (x > 0 && !visited[p - 1] && indexMap[p - 1] === color) {
        visited[p - 1] = 1
        stack.push(p - 1)
      }
      if (x < width - 1 && !visited[p + 1] && indexMap[p + 1] === color) {
        visited[p + 1] = 1
        stack.push(p + 1)
      }
      if (p >= width && !visited[p - width] && indexMap[p - width] === color) {
        visited[p - width] = 1
        stack.push(p - width)
      }
      if (p < total - width && !visited[p + width] && indexMap[p + width] === color) {
        visited[p + width] = 1
        stack.push(p + width)
      }
    }
    if (size < MIN_COMPONENT_CELLS) {
      specks++
      speckCells += size
    }
  }

  return { specks, speckCells }
}
