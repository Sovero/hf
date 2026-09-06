import type { HeightField, LoadedImage, Mesh, PrintSettings, QuantizedImage, RGB } from './types'
import { loadImageFromFile } from './loadImage'
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
  numColors: 2 | 4 | 8 | 12 | 16 | 24
  darkIsTall: boolean
  widthMm: number
  heightMm: number
  baseMm: number
  maxHeightMm: number
  /** Print layer height in mm; defaults to 0.2 when omitted. */
  layerMm?: number
}

/**
 * Full pipeline: image → quantize palette → luminance bands → relief heights
 * → mesh. Brightness decides each pixel's height, and its filament band is
 * the height band its column reaches; every printed layer is one color.
 */
export async function runPipeline(file: File, opts: PipelineOptions, lang: Lang = 'en'): Promise<PipelineResult> {
  const image = await loadImageFromFile(file, lang)

  // The palette is derived from the image's luminance bands, so no separate
  // color quantization step is needed — band colors are the band contents.
  const quantized = mapToLuminanceBands(image.rgba, opts.numColors, image.width, image.height, opts.darkIsTall)

  return finishPipeline(image, quantized, opts)
}

export function finishPipeline(
  image: LoadedImage,
  quantized: QuantizedImage,
  opts: PipelineOptions,
): PipelineResult {
  const settings: PrintSettings = {
    widthMm: opts.widthMm,
    heightMm: opts.heightMm,
    baseMm: opts.baseMm,
    maxHeightMm: opts.maxHeightMm,
    darkIsTall: opts.darkIsTall,
    layerMm: opts.layerMm ?? 0.2,
  }

  const field = buildHeightField(quantized, settings)
  const mesh = buildMesh(field, quantized.indexMap, quantized.palette, settings)

  const n = quantized.palette.length
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
export function exportFilename(result: PipelineResult, extension: 'stl' | '3mf' | 'txt'): string {
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
