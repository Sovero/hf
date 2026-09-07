import { strFromU8, unzipSync } from 'fflate'
import { hexToRgb, rgbToHex } from './palette'
import type { RGB } from './types'

export const MAX_REFERENCE_FILE_BYTES = 100 * 1024 * 1024
export const MAX_REFERENCE_ENTRY_BYTES = 25 * 1024 * 1024

export type Reference3mfStatus = 'complete' | 'partial'
export type Reference3mfPaletteSource = 'app-metadata' | 'custom-gcode' | 'filament-settings'

export interface Reference3mfModel {
  unit: string
  objectCount: number
  triangleCount: number
  vertexCount: number
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
  widthMm: number
  heightMm: number
  maxHeightMm: number
}

export interface Reference3mfPaletteEntry {
  color: RGB
  hex: string
  printOrder: number
  extruder?: number
  source: Reference3mfPaletteSource
}

export interface Reference3mfSwap {
  topZMm: number
  layer?: number
  extruder?: number
  color?: RGB
  hex?: string
}

export interface Reference3mfSettings {
  colorCount?: number
  widthMm?: number
  heightMm?: number
  baseMm?: number
  maxHeightMm?: number
  layerMm?: number
  darkIsTall?: boolean
  bandTops?: number[]
}

export interface Reference3mfAnalysis {
  fileName: string
  fileSizeBytes: number
  status: Reference3mfStatus
  model: Reference3mfModel
  palette: Reference3mfPaletteEntry[]
  swaps: Reference3mfSwap[]
  settings: Reference3mfSettings
  missingFields: string[]
  warnings: string[]
  canApply: boolean
  applyBlockedReason?: string
}

export type Reference3mfInput = File | ArrayBuffer | Uint8Array

export class Reference3mfParseError extends Error {
  readonly code: 'extension' | 'size' | 'archive' | 'missing-model' | 'entry-size' | 'xml' | 'unit'

  constructor(code: Reference3mfParseError['code'], message: string) {
    super(message)
    this.name = 'Reference3mfParseError'
    this.code = code
  }
}

const SUPPORTED_UNITS: Record<string, number> = {
  millimeter: 1,
  millimeters: 1,
  mm: 1,
  micrometer: 0.001,
  micrometers: 0.001,
  centimeter: 10,
  centimeters: 10,
  meter: 1000,
  meters: 1000,
  inch: 25.4,
  inches: 25.4,
  foot: 304.8,
  feet: 304.8,
}

const SUPPORTED_COLOR_COUNTS = new Set([2, 4, 8, 12, 16, 24])

function bytesOf(input: Reference3mfInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return Promise.resolve(input)
  if (input instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(input))
  return input.arrayBuffer().then((buffer) => new Uint8Array(buffer))
}

function inputName(input: Reference3mfInput): string {
  return typeof File !== 'undefined' && input instanceof File ? input.name : 'reference.3mf'
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&#([0-9]+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([:\w-]+)\s*=\s*(["'])(.*?)\2/g
  let match: RegExpExecArray | null
  while ((match = re.exec(tag))) out[match[1].toLowerCase()] = decodeXml(match[3])
  return out
}

function numberAttr(values: Record<string, string>, ...names: string[]): number | undefined {
  for (const name of names) {
    const value = Number(values[name.toLowerCase()])
    if (Number.isFinite(value)) return value
  }
  return undefined
}

function metadata(xml: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /<metadata\b([^>]*)>([\s\S]*?)<\/metadata\s*>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(xml))) {
    const a = attrs(match[1])
    const key = a.name ?? a.key
    if (key) out.set(key.toLowerCase(), decodeXml(match[2].trim()))
  }
  return out
}

function parseNumberList(value: string | undefined): number[] | undefined {
  if (!value) return undefined
  const values = value.split(/[,;\s]+/).filter(Boolean).map(Number)
  return values.length > 0 && values.every(Number.isFinite) ? values : undefined
}

function parseHexList(value: string | undefined): RGB[] | undefined {
  if (!value) return undefined
  const values = value.split(/[,;\s]+/).filter(Boolean)
  if (values.length === 0) return undefined
  const colors: RGB[] = []
  for (const raw of values) {
    try {
      colors.push(hexToRgb(raw.startsWith('#') ? raw : `#${raw}`))
    } catch {
      return undefined
    }
  }
  return colors
}

function unitFactor(unit: string | undefined): { name: string; factor: number } {
  const normalized = (unit ?? 'millimeter').toLowerCase()
  const factor = SUPPORTED_UNITS[normalized]
  if (factor === undefined) throw new Reference3mfParseError('unit', `Unsupported 3MF unit: ${unit ?? '(missing)'}`)
  return { name: normalized, factor }
}

function assertModelXml(xml: string): void {
  if (!/<model\b/i.test(xml) || !/<\/model\s*>/i.test(xml)) {
    throw new Reference3mfParseError('xml', 'The 3MF model XML is incomplete or malformed.')
  }
}

function parseModel(xml: string): Reference3mfModel {
  assertModelXml(xml)
  const modelTag = /<model\b([^>]*)>/i.exec(xml)?.[1] ?? ''
  const modelAttrs = attrs(modelTag)
  const unit = unitFactor(modelAttrs.unit)
  const vertices: number[][] = []
  const vertexRe = /<vertex\b([^>]*)>/gi
  let vertex: RegExpExecArray | null
  while ((vertex = vertexRe.exec(xml))) {
    const a = attrs(vertex[1])
    const x = numberAttr(a, 'x')
    const y = numberAttr(a, 'y')
    const z = numberAttr(a, 'z')
    if (x === undefined || y === undefined || z === undefined) {
      throw new Reference3mfParseError('xml', 'A 3MF vertex is missing numeric coordinates.')
    }
    vertices.push([x * unit.factor, y * unit.factor, z * unit.factor])
  }
  if (vertices.length === 0) throw new Reference3mfParseError('xml', 'The 3MF model contains no vertices.')

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const [x, y, z] of vertices) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }

  return {
    unit: unit.name,
    objectCount: [...xml.matchAll(/<object\b/gi)].length,
    triangleCount: [...xml.matchAll(/<triangle\b/gi)].length,
    vertexCount: vertices.length,
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    widthMm: maxX - minX,
    heightMm: maxY - minY,
    maxHeightMm: maxZ,
  }
}

function parseSwaps(xml: string): Reference3mfSwap[] {
  const swaps: Reference3mfSwap[] = []
  const re = /<layer\b([^>]*)>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(xml))) {
    const a = attrs(match[1])
    const topZMm = numberAttr(a, 'top_z', 'topz', 'z')
    if (topZMm === undefined) continue
    const extruder = numberAttr(a, 'extruder', 'tool', 'nozzle')
    const layer = numberAttr(a, 'layer', 'layer_num', 'print_layer')
    const rawColor = a.color ?? a.colour
    let color: RGB | undefined
    if (rawColor) {
      try { color = hexToRgb(rawColor) } catch { /* keep the swap without color */ }
    }
    swaps.push({
      topZMm,
      ...(layer === undefined ? {} : { layer: Math.max(1, Math.round(layer)) }),
      ...(extruder === undefined ? {} : { extruder: Math.max(1, Math.round(extruder)) }),
      ...(color ? { color, hex: rgbToHex(color) } : {}),
    })
  }
  return swaps.sort((a, b) => a.topZMm - b.topZMm)
}

function parseSettings(meta: Map<string, string>, model: Reference3mfModel): Reference3mfSettings {
  const number = (key: string) => {
    const value = Number(meta.get(key.toLowerCase()))
    return Number.isFinite(value) ? value : undefined
  }
  const count = number('colorcount')
  const depth = meta.get('depthmode')?.toLowerCase()
  return {
    ...(count === undefined ? {} : { colorCount: Math.round(count) }),
    widthMm: number('widthmm') ?? model.widthMm,
    heightMm: number('heightmm') ?? model.heightMm,
    baseMm: number('basemm'),
    maxHeightMm: number('maxheightmm') ?? model.maxHeightMm,
    layerMm: number('layermm'),
    ...(depth === 'darkistall' ? { darkIsTall: true } : depth === 'lightistall' ? { darkIsTall: false } : {}),
    bandTops: parseNumberList(meta.get('bandtops')),
  }
}

function paletteFromMetadata(meta: Map<string, string>): Reference3mfPaletteEntry[] {
  const colors = parseHexList(meta.get('palettehex'))
  if (!colors) return []
  const orders = parseNumberList(meta.get('printorder'))
  return colors.map((color, index) => ({
    color,
    hex: rgbToHex(color),
    printOrder: Math.max(1, Math.round(orders?.[index] ?? index + 1)),
    source: 'app-metadata' as const,
  })).sort((a, b) => a.printOrder - b.printOrder)
}

function paletteFromSwaps(swaps: Reference3mfSwap[], filamentXml?: string): Reference3mfPaletteEntry[] {
  const entries: Reference3mfPaletteEntry[] = []
  const baseColor = filamentXml ? parseDefaultFilamentColor(filamentXml) : undefined
  if (baseColor) entries.push({ color: baseColor, hex: rgbToHex(baseColor), printOrder: 1, source: 'filament-settings' })
  for (const swap of swaps) {
    if (!swap.color) continue
    const printOrder = swap.extruder ?? entries.length + 1
    if (entries.some((entry) => entry.printOrder === printOrder)) continue
    entries.push({ color: swap.color, hex: rgbToHex(swap.color), printOrder, ...(swap.extruder ? { extruder: swap.extruder } : {}), source: 'custom-gcode' })
  }
  return entries.sort((a, b) => a.printOrder - b.printOrder)
}

function parseDefaultFilamentColor(config: string): RGB | undefined {
  const match = /"default_filament_colour"\s*:\s*\[\s*"(#[0-9a-f]{6})"/i.exec(config)
  if (!match) return undefined
  try { return hexToRgb(match[1]) } catch { return undefined }
}

function addMissing(missing: string[], condition: boolean, field: string): void {
  if (condition && !missing.includes(field)) missing.push(field)
}

function applyReadiness(
  model: Reference3mfModel,
  palette: Reference3mfPaletteEntry[],
): { canApply: boolean; reason?: string } {
  if (model.objectCount !== 1) return { canApply: false, reason: 'Reference contains multiple model objects.' }
  if (palette.length === 0) return { canApply: false, reason: 'No filament palette was found.' }
  if (!SUPPORTED_COLOR_COUNTS.has(palette.length)) {
    return { canApply: false, reason: `The reference uses ${palette.length} colors; the editor supports 2, 4, 8, 12, 16, or 24.` }
  }
  if (!(model.widthMm > 0) || !(model.heightMm > 0) || !(model.maxHeightMm > 0)) {
    return { canApply: false, reason: 'The reference model has no usable dimensions.' }
  }
  return { canApply: true }
}

export async function parseReference3mf(input: Reference3mfInput): Promise<Reference3mfAnalysis> {
  const fileName = inputName(input)
  if (fileName !== 'reference.3mf' && !/\.3mf$/i.test(fileName)) {
    throw new Reference3mfParseError('extension', 'Choose a .3mf reference file.')
  }
  const bytes = await bytesOf(input)
  if (bytes.byteLength === 0) throw new Reference3mfParseError('size', 'The reference file is empty.')
  if (bytes.byteLength > MAX_REFERENCE_FILE_BYTES) {
    throw new Reference3mfParseError('size', 'The reference file is larger than the 100 MB limit.')
  }

  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new Reference3mfParseError('archive', 'The reference file is not a valid 3MF ZIP archive.')
  }
  const get = (suffix: string): Uint8Array | undefined => {
    const key = Object.keys(files).find((name) => name.toLowerCase() === suffix.toLowerCase())
    return key ? files[key] : undefined
  }
  const text = (entry: Uint8Array | undefined, required = false): string | undefined => {
    if (!entry) {
      if (required) throw new Reference3mfParseError('missing-model', 'The 3MF model part is missing.')
      return undefined
    }
    if (entry.byteLength > MAX_REFERENCE_ENTRY_BYTES) throw new Reference3mfParseError('entry-size', 'A 3MF metadata part exceeds the 25 MB limit.')
    return strFromU8(entry)
  }

  const modelXml = text(get('3d/3dmodel.model'), true)!
  const model = parseModel(modelXml)
  const meta = metadata(modelXml)
  const customXml = text(get('metadata/custom_gcode_per_layer.xml'))
  const swaps = customXml ? parseSwaps(customXml) : []
  const filamentXml = text(get('metadata/filament_settings_1.config'))
  const settings = parseSettings(meta, model)
  const normalizedSwaps = settings.layerMm
    ? swaps.map((swap) => swap.layer === undefined
      ? { ...swap, layer: Math.max(1, Math.round(swap.topZMm / settings.layerMm!)) }
      : swap)
    : swaps
  const palette = paletteFromMetadata(meta)
  const resolvedPalette = palette.length > 0 ? palette : paletteFromSwaps(normalizedSwaps, filamentXml)
  const missingFields: string[] = []
  const warnings: string[] = []
  addMissing(missingFields, resolvedPalette.length === 0, 'palette')
  addMissing(missingFields, normalizedSwaps.length === 0, 'swaps')
  addMissing(missingFields, settings.layerMm === undefined, 'layerMm')
  addMissing(missingFields, settings.baseMm === undefined, 'baseMm')
  addMissing(missingFields, settings.darkIsTall === undefined, 'depthMode')
  if (settings.bandTops === undefined && swaps.length === 0) addMissing(missingFields, true, 'bandTops')
  if (palette.length === 0 && resolvedPalette.length > 0) warnings.push('Palette recovered from tool-change and filament metadata.')
  if (normalizedSwaps.length === 0) warnings.push('No per-layer tool-change schedule was found.')
  if (settings.baseMm === undefined) warnings.push('Base height was not present in metadata; the mesh minimum is not assumed to be the base setting.')
  const readiness = applyReadiness(model, resolvedPalette)
  return {
    fileName,
    fileSizeBytes: bytes.byteLength,
    status: missingFields.length === 0 ? 'complete' : 'partial',
    model,
    palette: resolvedPalette,
    swaps: normalizedSwaps,
    settings,
    missingFields,
    warnings,
    canApply: readiness.canApply,
    ...(readiness.reason ? { applyBlockedReason: readiness.reason } : {}),
  }
}
