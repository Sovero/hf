import type { PipelineResult } from './pipeline'
import { MIN_REGION_CELLS } from './quantize'
import { snappedBandTops } from './heightmap'
import { t, word, mmOf, type Lang } from '../i18n'
import type { PrintSettings, QuantizedImage } from './types'

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

/**
 * A concrete, apply-able auto-fix for a failing check. The UI turns one of
 * these into a settings change (input value + reprocess).
 */
export type PrintabilityFix =
  | { kind: 'maxHeight'; to: number }
  | { kind: 'colors'; to: number }
  | { kind: 'bandHeights'; heights: number[] }
  | { kind: 'size'; width: number; height: number }

/** App-wide ceilings the fixer must respect (mirror readOptions/clamps). */
const MAX_HEIGHT_MM = 40
const MAX_SIZE_MM = 500
const MAX_BAND_HEIGHT_MM = 10

/**
 * Smallest band thickness (mm) the current geometry would have if the
 * settings were applied: a pure re-run of snappedBandTops, so the fixer
 * verifies its candidate settings against the exact same math the pipeline
 * uses — no off-by-half-layer surprises from grid rounding.
 */
function minSnappedBand(q: QuantizedImage, settings: PrintSettings): number {
  const tops = snappedBandTops(q, settings)
  let prev = settings.baseMm
  let minBand = Infinity
  for (const t of tops) {
    minBand = Math.min(minBand, t - prev)
    prev = t
  }
  return minBand
}

const round2 = (v: number) => Math.round(v * 100) / 100
const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * Compute the auto-fix for a check, or null when nothing within the app's
 * limits can repair it (or the check is fine).
 *
 * - 'bands' warn/fail: raise Max height so every band ≥ the nozzle width
 *   (bands thinner than the nozzle smear; bands at exactly one layer already
 *   print fine — snappedBandTops guarantees ≥ one layer by construction).
 *   Custom per-color heights are scaled up instead; if the 40 mm / 10 mm
 *   per-band ceilings block that, the color count is reduced.
 * - 'resolution' fail/warn: enlarge the print so each image cell maps to at
 *   least a layer (fail) or the nozzle width (warn).
 * - 'swaps' warn: reduce the color count just enough to drop below the
 *   change-warning threshold (keeps as many colors as possible).
 * - Everything else: no automatic fix (warnings are inherent to the artwork).
 */
export function fixFor(checkId: string, result: PipelineResult): PrintabilityFix | null {
  const { settings, quantized } = result
  const layerMm = settings.layerMm
  const baseMm = settings.baseMm
  const n = quantized.palette.length

  if (checkId === 'bands') {
    // The geometry already has every band at or above the nozzle width —
    // nothing to fix. (snappedBandTops forces bands ≥ one layer by
    // construction, so the fixable risk is bands thinner than the nozzle.)
    if (minSnappedBand(quantized, settings) >= NOZZLE_MM - 1e-9) return null

    // Custom per-color heights: scale every band up so the thinnest reaches
    // the nozzle width, then nudge the top band until the grid rounding
    // actually yields a passing geometry (the final top sits at maxHeight
    // exactly, so rounding of the band below can still starve it).
    const custom = quantized.bandHeightsMm
    if (custom && custom.length === n) {
      const hMin = Math.min(...custom)
      if (hMin < NOZZLE_MM) {
        const scale = NOZZLE_MM / hMin
        const scaled = custom.map((h) => Math.min(MAX_BAND_HEIGHT_MM, round2(h * scale)))
        const usable = MAX_HEIGHT_MM - baseMm
        for (let attempt = 0; attempt < 8; attempt++) {
          const total = scaled.reduce((a, c) => a + c, 0)
          if (total > usable) break
          const q2: QuantizedImage = { ...quantized, bandHeightsMm: scaled }
          const s2: PrintSettings = { ...settings, maxHeightMm: round2(baseMm + total) }
          const band = minSnappedBand(q2, s2)
          if (band >= NOZZLE_MM - 1e-9) return { kind: 'bandHeights', heights: scaled }
          // Grid rounding starved the top band: give it the shortfall.
          const topIdx = settings.darkIsTall ? 0 : n - 1
          scaled[topIdx] = round2(scaled[topIdx] + (NOZZLE_MM - band))
          if (scaled[topIdx] > MAX_BAND_HEIGHT_MM) break
        }
      }
      // Custom heights that cannot be scaled within limits fall through to
      // the color-count reduction below (which resets to equal heights).
    }

    // Equal heights: find the smallest max height on the layer grid whose
    // simulated geometry has every band ≥ the nozzle width.
    for (let usable = n * NOZZLE_MM; usable <= MAX_HEIGHT_MM - baseMm + 1e-9; usable += layerMm) {
      const candidate = round2(baseMm + usable)
      if (candidate > MAX_HEIGHT_MM) break
      const q2: QuantizedImage = { ...quantized, bandHeightsMm: undefined }
      const s2: PrintSettings = { ...settings, maxHeightMm: candidate }
      if (minSnappedBand(q2, s2) >= NOZZLE_MM - 1e-9) return { kind: 'maxHeight', to: candidate }
    }

    // Max height alone cannot fix it within 40 mm: reduce the color count
    // (equal population bands), keeping the current max height when it
    // already passes, otherwise growing it on the same grid search.
    for (let fewer = n - 1; fewer >= 2; fewer--) {
      const q2: QuantizedImage = {
        ...quantized,
        bandHeightsMm: undefined,
        bandTops: Array.from({ length: fewer }, (_, i) => (i + 1) / fewer),
      }
      if (minSnappedBand(q2, settings) >= NOZZLE_MM - 1e-9) return { kind: 'colors', to: fewer }
      for (let usable = fewer * NOZZLE_MM; usable <= MAX_HEIGHT_MM - baseMm + 1e-9; usable += layerMm) {
        const candidate = round2(baseMm + usable)
        if (candidate > MAX_HEIGHT_MM) break
        const s2: PrintSettings = { ...settings, maxHeightMm: candidate }
        if (minSnappedBand(q2, s2) >= NOZZLE_MM - 1e-9) return { kind: 'colors', to: fewer }
      }
    }
    return null
  }

  if (checkId === 'resolution') {
    const pos = result.mesh.positions
    let w = 0
    let h = 0
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i] > w) w = pos[i]
      if (pos[i + 1] > h) h = pos[i + 1]
    }
    const cellMm = Math.min(w / result.image.width, h / result.image.height)
    const target = cellMm < layerMm - 1e-9 ? layerMm : NOZZLE_MM
    if (cellMm >= target - 1e-9) return null
    const s = Math.min(target / cellMm, MAX_SIZE_MM / Math.max(w, h))
    if (s * cellMm < target - 1e-9) return null
    return { kind: 'size', width: round1(w * s), height: round1(h * s) }
  }

  if (checkId === 'swaps') {
    // Reduce the color count just enough to drop below the change-warning
    // threshold — the least destructive fix, quality-wise.
    if (n - 1 >= MIN_SWAPS_WARN) return { kind: 'colors', to: Math.max(2, MIN_SWAPS_WARN) }
    return null
  }

  return null
}

/** Typical nozzle diameter (mm). */
const NOZZLE_MM = 0.4
/** Warn when at least this many specks appear. */
const MIN_SPECKS = 5
/** ...or when specks cover this fraction of the image. */
const MIN_SPECK_FRACTION = 0.005
/** Warn when the print needs this many filament changes. */
const MIN_SWAPS_WARN = 6

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
  let widthMm = 0
  let heightMm = 0
  const pos = result.mesh.positions
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] > widthMm) widthMm = pos[i]
    if (pos[i + 1] > heightMm) heightMm = pos[i + 1]
  }

  // The layer height the user chose drives all band/layer math. Band sizes
  // come from the actual snapped band tops (base → first top, between tops,
  // last top → max): equal bands are usable/n each, and with custom per-color
  // heights the thinnest band is the real thin-band risk.
  const layerMm = result.settings.layerMm
  const sortedTops = [...result.palette].sort((a, b) => a.topZMm - b.topZMm).map((p) => p.topZMm)
  const bandSizes: number[] = []
  let prevTop = result.settings.baseMm
  for (const t of sortedTops) {
    bandSizes.push(t - prevTop)
    prevTop = t
  }
  const bandMm = Math.min(...bandSizes)
  const customHeights = !!result.quantized.bandHeightsMm
  const layersPerBand = bandMm / layerMm
  const totalLayers = result.settings.maxHeightMm / layerMm
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
  // snappedBandTops forces every band to at least one layer (monotonicity
  // clamp), so a sub-layer band can only appear through float dust (e.g.
  // 0.29999999999999993 vs 0.3). Compare with a small epsilon so a band that
  // is exactly one layer — which prints fine as a single-layer sheet — is
  // never flagged as an error. The real risk below the nozzle is smearing.
  if (bandMm < layerMm - 1e-6) {
    checks.push({
      id: 'bands',
      level: 'fail',
      title: str('pbBandsTitleFail'),
      detail: str(customHeights ? 'pbBandsDetailFailCustom' : 'pbBandsDetailFail', { band: mm(bandMm), layer: mm(layerMm) }),
    })
  } else if (bandMm < NOZZLE_MM - 1e-6) {
    checks.push({
      id: 'bands',
      level: 'warn',
      title: str('pbBandsTitleWarn'),
      detail: str(customHeights ? 'pbBandsDetailWarnCustom' : 'pbBandsDetailWarn', {
        band: mm(bandMm),
        layersText: layersText(layersPerBand),
        layer: mm(layerMm),
        nozzle: mm(NOZZLE_MM),
      }),
    })
  } else {
    checks.push({
      id: 'bands',
      level: 'ok',
      title: str('pbBandsTitleOk'),
      detail: str(customHeights ? 'pbBandsDetailOkCustom' : 'pbBandsDetailOk', {
        band: mm(bandMm),
        layersText: layersText(layersPerBand),
        layer: mm(layerMm),
      }),
    })
  }

  // ---- 2. Feature resolution vs nozzle ----
  if (cellMm < layerMm - 1e-6) {
    checks.push({
      id: 'resolution',
      level: 'fail',
      title: str('pbResTitleFail'),
      detail: str('pbResDetailFail', { cell: mm(cellMm), layer: mm(layerMm) }),
    })
  } else if (cellMm < NOZZLE_MM - 1e-6) {
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
  // Fragile specks are flattened by the quantizer (removeIsolatedRegions),
  // but a few can survive on complex images — they are inherent to the
  // artwork, so the auto-fixer never touches them (no settings change is
  // meaningful). The warning simply explains what is happening.
  const dithered = result.quantized.cleanIndexMap !== undefined
  const { specks, speckCells } = findIsolatedRegions(
    result.quantized.cleanIndexMap ?? result.quantized.indexMap,
    result.image.width,
    result.image.height,
  )
  const fraction = speckCells / (result.image.width * result.image.height)
  if (specks >= MIN_SPECKS || fraction >= MIN_SPECK_FRACTION) {
    checks.push({
      id: 'support',
      level: 'warn',
      title: str('pbSupportTitleWarn'),
      detail: str('pbSupportDetailWarn', {
        regionsText: regionsText(specks),
        fraction: (fraction * 100).toFixed(1),
      }) + (dithered ? ` ${str('pbSupportDitherNote')}` : ''),
    })
  } else if (dithered) {
    checks.push({
      id: 'support',
      level: 'ok',
      title: str('pbSupportTitleOk'),
      detail: `${str('pbSupportDetailOk')} ${str('pbSupportDetailOkDither')}`,
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
 * Auto-fix map for the printability check ids. Only checks that have a
 * concrete settings change (bands, resolution, swaps) are listed here.
 * Fragile isolated regions ('support') are inherently artwork — no settings
 * tweak meaningfully removes them; fixFor('support') returns null.
 */
export const FIXER: Record<string, (result: PipelineResult) => PrintabilityFix | null> = {
  bands: (r) => fixFor('bands', r),
  resolution: (r) => fixFor('resolution', r),
  swaps: (r) => fixFor('swaps', r),
  support: () => null,
}

/**
 * Count connected same-color regions smaller than MIN_REGION_CELLS cells
 * (4-connectivity). These are quantization speckles / tiny islands that print
 * poorly — the closest this geometry comes to "unsupported" features.
 */
export function findIsolatedRegions(indexMap: Uint8Array, width: number, height: number): { specks: number; speckCells: number } {
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
    if (size < MIN_REGION_CELLS) {
      specks++
      speckCells += size
    }
  }

  return { specks, speckCells }
}
