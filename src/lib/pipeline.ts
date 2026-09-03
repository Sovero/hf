import type { HeightField, LoadedImage, Mesh, PrintSettings, QuantizedImage, RGB } from './types'
import { loadImageFromFile } from './loadImage'
import type { Lang } from '../i18n'
import { quantize, mapToPalette } from './quantize'
import { sortByLuminance } from './palette'
import { buildHeightField } from './heightmap'
import { buildMesh } from './mesh'
import { generateBinaryStl } from './exportStl'
import { generate3mf } from './export3mf'

/** One palette entry with its role in the print order. */
export interface PaletteEntry {
  color: RGB
  /** Z-height of this color's top surface (mm). */
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
}

export interface PipelineOptions {
  numColors: 2 | 4 | 8 | 12 | 16 | 24
  darkIsTall: boolean
  widthMm: number
  heightMm: number
  baseMm: number
  maxHeightMm: number
}

/**
 * Full pipeline: image → quantize → luminance-sorted palette → heights → mesh.
 * Palette is always ordered darkest → lightest; band index depends on depth mode.
 */
export async function runPipeline(file: File, opts: PipelineOptions, lang: Lang = 'en'): Promise<PipelineResult> {
  const image = await loadImageFromFile(file, lang)

  const rawPalette = quantize(image.rgba, opts.numColors)
  const palette = sortByLuminance(rawPalette)
  const quantized = mapToPalette(image.rgba, palette, image.width, image.height)

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
  }

  const field = buildHeightField(quantized, settings)
  const mesh = buildMesh(field, quantized.indexMap, quantized.palette, settings)

  const n = quantized.palette.length
  const step = n > 1 ? (settings.maxHeightMm - settings.baseMm) / (n - 1) : 0
  const palette: PaletteEntry[] = quantized.palette.map((color, idx) => ({
    color,
    topZMm: settings.baseMm + (settings.darkIsTall ? n - 1 - idx : idx) * step,
    printOrder: settings.darkIsTall ? n - idx : idx + 1,
  }))

  return { image, quantized, palette, field, mesh, darkIsTall: opts.darkIsTall }
}

export function exportStl(result: PipelineResult): ArrayBuffer {
  return generateBinaryStl(result.mesh)
}

/**
 * Descriptive export filename, e.g. hueforge-16colors-150x150mm.stl.
 * Dimensions come from the mesh bounds so they always match the geometry.
 */
export function exportFilename(result: PipelineResult, extension: 'stl' | '3mf'): string {
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
  return generate3mf({ mesh: result.mesh, modelName: name, printSettings: hints })
}
