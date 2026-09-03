import type { PipelineResult } from './pipeline'

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

const mm = (v: number) => `${v.toFixed(2)} mm`

/**
 * Analyze a finished pipeline result for 3D-printability concerns.
 *
 * The geometry is a per-column stepped relief: every column is solid from the
 * base up and all walls are vertical (≤90°), so higher layers always rest on
 * material below — true overhangs cannot occur and supports are never needed.
 * The real risks are thin color bands, feature resolution vs the nozzle, the
 * number of manual filament changes, and fragile isolated regions.
 */
export function analyzePrintability(result: PipelineResult): PrintabilityReport {
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

  const bandMm = n > 1 ? (maxH - minH) / (n - 1) : maxH - minH
  const layersPerBand = bandMm / LAYER_MM
  const totalLayers = maxH / LAYER_MM
  const swaps = n - 1
  // Finest resolvable detail is limited by the finer axis: if either axis
  // produces cells below the nozzle width, detail on that axis will smear.
  const cellMm = Math.min(widthMm / result.image.width, heightMm / result.image.height)

  // ---- 1. Color band thickness ----
  if (bandMm < LAYER_MM) {
    checks.push({
      id: 'bands',
      level: 'fail',
      title: 'Color bands thinner than one layer',
      detail: `Each color is only ${mm(bandMm)} — less than a single ${LAYER_MM.toFixed(1)} mm layer, so bands cannot be printed as distinct sheets. Increase Max height or reduce the color count.`,
    })
  } else if (bandMm < NOZZLE_MM) {
    checks.push({
      id: 'bands',
      level: 'warn',
      title: 'Thin color bands',
      detail: `Each color is ${mm(bandMm)} (~${layersPerBand.toFixed(1)} layers @${LAYER_MM.toFixed(1)} mm) — thinner than the ${NOZZLE_MM.toFixed(1)} mm nozzle, so transitions will smear. Increase Max height or use fewer colors.`,
    })
  } else {
    checks.push({
      id: 'bands',
      level: 'ok',
      title: 'Color band thickness',
      detail: `Each color is ${mm(bandMm)} ≈ ${layersPerBand.toFixed(1)} layers @${LAYER_MM.toFixed(1)} mm — clean filament transitions.`,
    })
  }

  // ---- 2. Feature resolution vs nozzle ----
  if (cellMm < LAYER_MM) {
    checks.push({
      id: 'resolution',
      level: 'fail',
      title: 'Image cells far below nozzle width',
      detail: `Each image cell is only ${mm(cellMm)} — smaller than one ${LAYER_MM.toFixed(1)} mm layer; adjacent colors will merge into noise. Print much larger or use a smaller image.`,
    })
  } else if (cellMm < NOZZLE_MM) {
    checks.push({
      id: 'resolution',
      level: 'warn',
      title: 'Features smaller than the nozzle',
      detail: `Each image cell is ${mm(cellMm)} — below the ${NOZZLE_MM.toFixed(1)} mm nozzle, so fine detail will blend. Print larger (e.g. 200+ mm) to sharpen it.`,
    })
  } else {
    checks.push({
      id: 'resolution',
      level: 'ok',
      title: 'Feature resolution vs nozzle',
      detail: `Each image cell is ${mm(cellMm)} — at or above the ${NOZZLE_MM.toFixed(1)} mm nozzle; fine detail is preserved.`,
    })
  }

  // ---- 3. Filament changes (layer count vs manual work) ----
  if (swaps >= MIN_SWAPS_WARN) {
    checks.push({
      id: 'swaps',
      level: 'warn',
      title: 'Many filament changes',
      detail: `${n} colors = ${swaps} manual filament changes (plus purge towers) over ~${totalLayers.toFixed(0)} layers — a long, hands-on print. Consider fewer colors.`,
    })
  } else {
    checks.push({
      id: 'swaps',
      level: 'ok',
      title: 'Filament changes',
      detail: `${n} colors = ${swaps} manual filament changes over ~${totalLayers.toFixed(0)} layers — manageable.`,
    })
  }

  // ---- 4. Support & overhang risk (isolated fragile regions) ----
  const { specks, speckCells } = findIsolatedRegions(result.quantized.indexMap, result.image.width, result.image.height)
  const fraction = speckCells / (result.image.width * result.image.height)
  if (specks >= MIN_SPECKS || fraction >= MIN_SPECK_FRACTION) {
    checks.push({
      id: 'support',
      level: 'warn',
      title: 'Fragile isolated regions',
      detail: `All walls are vertical (≤90°) and every layer rests on material below, so no supports or true overhangs exist — but ${specks} tiny regions (under 3×3 cells, ~${(fraction * 100).toFixed(1)}% of the image) will print as fragile towers or speckles. Smooth the image or reduce the color count.`,
    })
  } else {
    checks.push({
      id: 'support',
      level: 'ok',
      title: 'Support & overhangs',
      detail: 'All walls are vertical (≤90°) and every layer is supported from below — no supports needed, no overhang risk.',
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