import type { PipelineOptions, PipelineResult } from './pipeline'
import { finishPipeline } from './pipeline'
import { mapToLuminanceBands } from './quantize'
import type { Reference3mfAnalysis, Reference3mfSwap } from './reference3mf'
import { luminance } from './palette'
import type { LoadedImage, RGB } from './types'

/** Current editor values the adapter may fall back to for missing fields. */
export interface CurrentEditorOptions {
  numColors: number
  darkIsTall: boolean
  widthMm: number
  heightMm: number
  baseMm: number
  maxHeightMm: number
  layerMm: number
}

/** Editor inputs a reference can carry. */
export type ReferenceApplyField =
  | 'colorCount'
  | 'widthMm'
  | 'heightMm'
  | 'baseMm'
  | 'maxHeightMm'
  | 'layerMm'
  | 'depthMode'
  | 'palette'
  | 'schedule'

/**
 * applied — the reference supplied the value and it is used.
 * unavailable — not in the reference; the editor keeps its current value.
 * fallback — the reference could not supply it; the pipeline derives it
 *   from the image instead (band heights only).
 */
export type ReferenceApplyState = 'applied' | 'unavailable' | 'fallback'

export interface ReferenceFieldReport {
  field: ReferenceApplyField
  state: ReferenceApplyState
  /** Where an applied value came from, e.g. 'metadata' | 'tool changes'. */
  source?: string
}

export interface ReferenceApplyPlan {
  canApply: boolean
  blockedReason?: string
  /** Full control set to load into the editor (applied + kept values). */
  options: PipelineOptions
  /** Reference colors sorted darkest → lightest (the pipeline's palette order). */
  paletteOverride: RGB[] | null
  /** Reference band boundaries as usable-height fractions, bottom → top, last = 1. */
  bandTopsOverride: number[] | null
  fields: ReferenceFieldReport[]
  warnings: string[]
}

const SUPPORTED_COLOR_COUNTS: readonly number[] = [2, 4, 8, 12, 16, 24]
const EPS = 1e-6

function blockedPlan(
  reason: string,
  current: CurrentEditorOptions,
  fields: ReferenceFieldReport[],
): ReferenceApplyPlan {
  return {
    canApply: false,
    blockedReason: reason,
    options: {
      numColors: current.numColors as PipelineOptions['numColors'],
      darkIsTall: current.darkIsTall,
      widthMm: current.widthMm,
      heightMm: current.heightMm,
      baseMm: current.baseMm,
      maxHeightMm: current.maxHeightMm,
      layerMm: current.layerMm,
    },
    paletteOverride: null,
    bandTopsOverride: null,
    fields,
    warnings: [],
  }
}

function mark(
  fields: ReferenceFieldReport[],
  field: ReferenceApplyField,
  state: ReferenceApplyState,
  source?: string,
): void {
  fields.push({ field, state, ...(source === undefined ? {} : { source }) })
}

/**
 * Keep only finite internal boundaries in (0, 1), deduped and strictly
 * ascending; a usable schedule for n colors has exactly n-1 of them
 * (the final 1 is appended here).
 */
function sanitizeBounds(values: number[], n: number): number[] | null {
  const cleaned: number[] = []
  for (const v of values) {
    if (!Number.isFinite(v)) return null
    if (v <= EPS || v >= 1 - EPS) continue
    if (cleaned.length > 0 && v <= cleaned[cleaned.length - 1] + EPS) continue
    cleaned.push(v)
  }
  return cleaned.length === n - 1 ? [...cleaned, 1] : null
}

/**
 * Internal band boundaries (mm) from a reference's tool-change layers.
 *
 * Two on-disk conventions exist. A change list records one entry per tool
 * change, at the height where the next color starts (this app's exports).
 * Per-layer data records one entry per printed layer with the tool that
 * prints it (Bambu/HueForge style), so a boundary sits at the top of the
 * last layer printed with the previous tool. Consecutive repeated tools
 * identify the per-layer form; otherwise entries are treated as a change
 * list. Returns null when the entries cannot form n-1 boundaries.
 */
function boundariesFromSwaps(
  swaps: Reference3mfSwap[],
  base: number,
  max: number,
): number[] | null | 'no-tool-info' {
  const toolOf = (s: Reference3mfSwap): string | undefined =>
    s.extruder !== undefined ? `t${s.extruder}` : s.hex !== undefined ? s.hex : undefined
  const identified = swaps.filter((s) => toolOf(s) !== undefined)
  if (identified.length === 0) return 'no-tool-info'

  const zOf = (s: Reference3mfSwap): number | null => {
    const z = s.topZMm
    if (!Number.isFinite(z) || z <= base + EPS || z >= max - EPS) return null
    return z
  }

  const hasRepeat = identified.some((s, i) => i > 0 && toolOf(s) === toolOf(identified[i - 1]))
  const zs: number[] = []
  if (hasRepeat) {
    let running = toolOf(identified[0])!
    for (let i = 1; i < identified.length; i++) {
      const tool = toolOf(identified[i])!
      if (tool !== running) {
        const z = zOf(identified[i - 1])
        if (z !== null) zs.push(z)
        running = tool
      }
    }
  } else {
    for (const s of identified) {
      const z = zOf(s)
      if (z !== null) zs.push(z)
    }
  }
  return zs
}

/**
 * Build the apply plan for a parsed reference: which fields the editor takes
 * over, which stay as they are, and whether the reference is representable
 * at all. Pure — nothing is changed until `reprocessWithReference` runs.
 */
export function planReferenceApply(
  analysis: Reference3mfAnalysis,
  current: CurrentEditorOptions,
): ReferenceApplyPlan {
  const fields: ReferenceFieldReport[] = []
  const warnings: string[] = [...analysis.warnings]

  if (!analysis.canApply) {
    return blockedPlan(analysis.applyBlockedReason ?? 'The reference cannot be applied.', current, fields)
  }

  const paletteColors = analysis.palette.map((e) => e.color)
  const n = paletteColors.length

  if (!SUPPORTED_COLOR_COUNTS.includes(n)) {
    return blockedPlan(
      `The reference uses ${n} colors; the editor supports 2, 4, 8, 12, 16, or 24.`,
      current,
      fields,
    )
  }

  const declared = analysis.settings.colorCount
  if (declared !== undefined && Math.round(declared) !== n) {
    warnings.push(
      `Metadata declares ${Math.round(declared)} colors but ${n} were recovered; the recovered palette is used.`,
    )
  }
  mark(fields, 'colorCount', 'applied', 'palette')

  // Dimensions: the parser resolves metadata first, then the mesh bounds.
  const widthMm = analysis.settings.widthMm ?? analysis.model.widthMm
  const heightMm = analysis.settings.heightMm ?? analysis.model.heightMm
  const maxHeightMm = analysis.settings.maxHeightMm ?? analysis.model.maxHeightMm
  mark(fields, 'widthMm', 'applied', 'reference')
  mark(fields, 'heightMm', 'applied', 'reference')
  mark(fields, 'maxHeightMm', 'applied', 'reference')

  const baseFromRef = analysis.settings.baseMm
  const baseMm = baseFromRef ?? current.baseMm
  mark(fields, 'baseMm', baseFromRef !== undefined ? 'applied' : 'unavailable', 'metadata')

  const layerFromRef = analysis.settings.layerMm
  const layerMm = layerFromRef ?? current.layerMm
  mark(fields, 'layerMm', layerFromRef !== undefined ? 'applied' : 'unavailable', 'metadata')

  if (!(maxHeightMm > baseMm)) {
    return blockedPlan(
      `The reference height (${maxHeightMm} mm) does not exceed the base height (${baseMm} mm).`,
      current,
      fields,
    )
  }

  // Depth mode: explicit metadata wins; otherwise infer from how the
  // reference's print order relates to color luminance.
  const byLuma = [...analysis.palette].sort((a, b) => luminance(a.color) - luminance(b.color))
  const orders = byLuma.map((e) => e.printOrder)
  const ascending = orders.every((o, i) => i === 0 || o > orders[i - 1])
  const descending = orders.every((o, i) => i === 0 || o < orders[i - 1])
  const metaDepth = analysis.settings.darkIsTall
  let darkIsTall = current.darkIsTall
  if (metaDepth !== undefined) {
    darkIsTall = metaDepth
  } else if (ascending) {
    darkIsTall = false
  } else if (descending) {
    darkIsTall = true
  }
  mark(fields, 'depthMode', metaDepth !== undefined || ascending || descending ? 'applied' : 'unavailable', metaDepth !== undefined ? 'metadata' : 'print order')
  if (!ascending && !descending) {
    warnings.push('The reference print order is not luminance-monotonic; colors are normalized to the editor’s dark → light band order.')
  }

  mark(fields, 'palette', 'applied', analysis.palette[0]?.source)
  const paletteOverride = [...paletteColors].sort((a, b) => luminance(a) - luminance(b))

  // Band schedule: bandTops metadata first, then tool-change layers;
  // with neither, the pipeline keeps its image-derived bands.
  let bandTopsOverride: number[] | null = null
  if (analysis.settings.bandTops !== undefined) {
    const tops = sanitizeBounds(analysis.settings.bandTops, n)
    if (!tops) {
      return blockedPlan(`The reference band schedule cannot be mapped onto ${n} colors.`, current, fields)
    }
    bandTopsOverride = tops
    mark(fields, 'schedule', 'applied', 'bandTops metadata')
  } else if (analysis.swaps.length > 0) {
    const zmms = boundariesFromSwaps(analysis.swaps, baseMm, maxHeightMm)
    if (zmms === 'no-tool-info') {
      mark(fields, 'schedule', 'fallback', 'tool-change layers carry no color info')
      warnings.push('The reference tool-change layers carry no color information; band heights come from the image.')
    } else {
      const tops = zmms === null ? null : sanitizeBounds(zmms.map((z) => (z - baseMm) / (maxHeightMm - baseMm)), n)
      if (!tops) {
        return blockedPlan(`The reference tool-change schedule cannot be mapped onto ${n} colors.`, current, fields)
      }
      bandTopsOverride = tops
      mark(fields, 'schedule', 'applied', 'tool changes')
    }
  } else {
    mark(fields, 'schedule', 'fallback', 'no schedule in reference')
    warnings.push('The reference carries no band schedule; band heights come from the image.')
  }

  return {
    canApply: true,
    options: {
      numColors: n as PipelineOptions['numColors'],
      darkIsTall,
      widthMm,
      heightMm,
      baseMm,
      maxHeightMm,
      layerMm,
    },
    paletteOverride,
    bandTopsOverride,
    fields,
    warnings,
  }
}

/**
 * Reprocess the current image under an apply plan: the image decides which
 * pixels belong to which band (as always), while the reference supplies the
 * band colors and heights. The image object is reused, never replaced.
 */
export function reprocessWithReference(image: LoadedImage, plan: ReferenceApplyPlan): PipelineResult {
  if (!plan.canApply) throw new Error(plan.blockedReason ?? 'The reference cannot be applied.')
  const quantized = mapToLuminanceBands(
    image.rgba,
    plan.options.numColors,
    image.width,
    image.height,
    plan.options.darkIsTall,
  )
  if (plan.paletteOverride) quantized.palette = plan.paletteOverride
  if (plan.bandTopsOverride) quantized.bandTops = plan.bandTopsOverride
  return finishPipeline(image, quantized, plan.options)
}
