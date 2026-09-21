import type { ColorCount, HeightField, LoadedImage, Mesh, PrintSettings, QuantizedImage, RGB } from './types'
import { loadImageForPrint } from './loadImage'
import type { Lang } from '../i18n'
import { mapToLuminanceBands } from './quantize'
import { buildHeightField, snappedBandTops } from './heightmap'
import { buildMesh } from './mesh'
import { generateBinaryStl } from './exportStl'
import { generate3mf } from './export3mf'

/** One palette entry with its role in the print order. */
export interface PaletteEntry {
  color: RGB
  /**
   * Z-height of the top of this filament's height band (mm). Color changes
   * happen here: below this height the whole model prints in this band's
   * filament, above it in the next one — so each printed layer is one color.
   */
  topZMm: number
  /** 1 = first filament loaded, N = last (top) color. */
  printOrder: number
}

export interface PipelineResult {
  image: LoadedImage
  quantized: QuantizedImage
  palette: PaletteEntry[]
  field: HeightField
  mesh: Mesh
  /** True when the darkest color is the tallest (printed last, on top). */
  darkIsTall: boolean
  /** The resolved print settings (incl. chosen layer height). */
  settings: PrintSettings
}

export interface PipelineOptions {
  numColors: ColorCount
  darkIsTall: boolean
  widthMm: number
  heightMm: number
  baseMm: number
  maxHeightMm: number
  /** Print layer height in mm; defaults to 0.2 when omitted. */
  layerMm?: number
  /**
   * Merge adjacent palette bands whose colors sit closer than this ΔE
   * (CIE76). 0 (default) disables the pass. Consumed by the worker's
   * quantize step; harmless elsewhere.
   */
  mergeDeltaE?: number
  /** Floyd–Steinberg dithering strength 0..1 (0 = off, the default). */
  dither?: number
  /**
   * Relief contrast 0..3 (1 = the picture's own tones), part of the tone
   * stage — see ToneCurve in quantize.ts. Shifts relief heights only: the
   * pixel → filament assignment does not change.
   */
  contrast?: number
  /**
   * Relief power (detail deepening) 0.2..3 (1 = unchanged): above 1 mid-tones
   * sink toward the base, below 1 they rise. Also heights only.
   */
  power?: number
  /**
   * Per-band sheet thickness in mm (palette order, dark → light), HueForge
   * style. When present and valid, the total model height becomes
   * base + Σ thicknesses (the max-height input is then derived, not free).
   */
  bandHeightsMm?: number[]
}

/**
 * Full pipeline: image → quantize palette → luminance bands → relief heights
 * → mesh. Brightness decides each pixel's height, and its filament band is
 * the height band its column reaches; every printed layer is one color.
 *
 * The working resolution fits the print size (each cell ≥ one nozzle width),
 * so the decode is re-run when the size settings change.
 */
export async function runPipeline(file: File, opts: PipelineOptions, lang: Lang = 'en'): Promise<PipelineResult> {
  const { image } = await loadImageForPrint(file, opts.widthMm, opts.heightMm, lang)

  // The palette is derived from the image's luminance bands, so no separate
  // color quantization step is needed — band colors are the band contents.
  const quantized = mapToLuminanceBands(
    image.rgba,
    opts.numColors,
    image.width,
    image.height,
    opts.darkIsTall,
    opts.dither,
    { contrast: opts.contrast, power: opts.power },
  )

  return finishPipeline(image, quantized, opts)
}

export function finishPipeline(
  image: LoadedImage,
  quantized: QuantizedImage,
  opts: PipelineOptions,
): PipelineResult {
  const n = quantized.palette.length
  // Custom band heights make the sum authoritative: maxHeight = base + Σh,
  // clamped to the app-wide 40 mm ceiling by scaling the heights so the
  // geometry always stays consistent (the UI prevents this while dragging).
  const custom = opts.bandHeightsMm
  const hasCustom =
    !!custom &&
    custom.length === n &&
    custom.every((h) => Number.isFinite(h) && h > 0) &&
    custom.every((h) => h <= 10)
  let heights: number[] | undefined
  let maxHeightMm = opts.maxHeightMm
  if (hasCustom) {
    const usableMax = 40 - opts.baseMm
    const total = custom!.reduce((a, c) => a + c, 0)
    const scale = total > usableMax ? usableMax / total : 1
    heights = custom!.map((h) => h * scale)
    quantized.bandHeightsMm = heights
    maxHeightMm = opts.baseMm + heights.reduce((a, c) => a + c, 0)
  } else {
    delete quantized.bandHeightsMm
  }

  const settings: PrintSettings = {
    widthMm: opts.widthMm,
    heightMm: opts.heightMm,
    baseMm: opts.baseMm,
    maxHeightMm,
    darkIsTall: opts.darkIsTall,
    layerMm: opts.layerMm ?? 0.2,
  }
  // Neutral tone is omitted on purpose: an absent field means "the picture's
  // own tones", which keeps older projects, undo snapshots and exports
  // byte-identical to the pre-tone geometry.
  const contrastPct = Math.round((opts.contrast ?? 1) * 100)
  const powerPct = Math.round((opts.power ?? 1) * 100)
  if (contrastPct !== 100) settings.contrastPct = contrastPct
  if (powerPct !== 100) settings.powerPct = powerPct

  const field = buildHeightField(quantized, settings)
  const mesh = buildMesh(field, quantized.indexMap, quantized.palette, settings)

  // Each filament owns one contiguous block of the total height (base..max);
  // its top comes from the equal-population band boundaries, snapped to the
  // whole-layer grid of the chosen layer height, so a tool change always lands
  // exactly on a slicer layer. buildHeightField uses the same snapped tops, so
  // the mesh geometry and the swap schedule agree to the millimeter.
  const snappedSlice = snappedBandTops(quantized, settings)
  const palette: PaletteEntry[] = quantized.palette.map((color, idx) => {
    const printOrder = settings.darkIsTall ? n - idx : idx + 1
    const slice = settings.darkIsTall ? n - 1 - idx : idx
    return { color, topZMm: snappedSlice[slice], printOrder }
  })

  return { image, quantized, palette, field, mesh, darkIsTall: opts.darkIsTall, settings }
}

export function exportStl(result: PipelineResult): ArrayBuffer {
  return generateBinaryStl(result.mesh)
}

/**
 * Descriptive export filename, e.g. hueforge-16colors-150x150mm.stl.
 * Dimensions come from the mesh bounds so they always match the geometry.
 */
export function exportFilename(
  result: PipelineResult,
  extension: 'stl' | '3mf' | 'txt' | 'zip',
): string {
  const n = result.quantized.palette.length
  let w = 0
  let h = 0
  const pos = result.mesh.positions
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] > w) w = pos[i]
    if (pos[i + 1] > h) h = pos[i + 1]
  }
  const fmt = (v: number) => String(parseFloat(v.toFixed(2)))
  return `hueforge-${n}colors-${fmt(w)}x${fmt(h)}mm.${extension}`
}

export function export3mfFile(result: PipelineResult, name: string): Uint8Array {
  const hints: Record<string, string> = {
    ColorCount: String(result.quantized.palette.length),
    DepthMode: result.darkIsTall ? 'darkIsTall' : 'lightIsTall',
    WidthMm: String(result.settings.widthMm),
    HeightMm: String(result.settings.heightMm),
    BaseMm: String(result.settings.baseMm),
    MaxHeightMm: String(result.settings.maxHeightMm),
    LayerMm: String(result.settings.layerMm),
    ...(result.settings.contrastPct !== undefined ? { ContrastPct: String(result.settings.contrastPct) } : {}),
    ...(result.settings.powerPct !== undefined ? { PowerPct: String(result.settings.powerPct) } : {}),
    BandTops: result.palette
      .slice()
      .sort((a, b) => a.topZMm - b.topZMm)
      .map((p) => ((p.topZMm - result.settings.baseMm) / (result.settings.maxHeightMm - result.settings.baseMm)).toFixed(8))
      .join(','),
    PaletteHex: result.quantized.palette.map((c) => `${c.r.toString(16).padStart(2, '0')}${c.g.toString(16).padStart(2, '0')}${c.b.toString(16).padStart(2, '0')}`).join(','),
    PrintOrder: result.palette.map((p) => p.printOrder).join(','),
  }
  return generate3mf({
    mesh: result.mesh,
    modelName: name,
    bands: result.palette,
    printSettings: hints,
  })
}
