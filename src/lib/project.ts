/**
 * Portable HueForge project files (.hueforge.json): everything needed to
 * resume work on another machine — the original image (as a data URL), all
 * print settings, and the palette (per-slot hex, fitted τ, and the chosen
 * filament). Custom user filaments are embedded in full so a project never
 * depends on local state; library filaments are referenced by stable id.
 *
 * Pure data module — no DOM, testable in Node.
 */

export interface EmbeddedFilament {
  /** Composite id, always starting with `my:` for user filaments. */
  id: string
  nameRu: string
  nameEn: string
  hex: string
  materialId: string
}

export interface ProjectPaletteSlot {
  /** #rrggbb hex of the band color. */
  hex: string
  /** Per-filament opacity length τ in mm. */
  tauMm: number
  /** Library filament composite id (`brand:material:color`). */
  filamentId?: string
  /** Full record for user-added filaments, embedded so the project is portable. */
  filament?: EmbeddedFilament
}

export interface ProjectSettings {
  colors: number
  widthMm: number
  heightMm: number
  baseMm: number
  maxMm: number
  layerMm: number
  /** Dithering strength 0..100 (percent), 0 = off. */
  dither: number
  /** ΔE merge threshold for adjacent near-duplicate bands; 0 = off. */
  mergeDeltaE?: number
  darkIsTall: boolean
  backlight: boolean
  /** Per-band sheet thickness in mm (palette order); absent = equal bands. */
  bandHeightsMm?: number[]
}

export interface ProjectFile {
  app: 'hueforge-web'
  version: 1
  image: { name: string; dataUrl: string }
  settings: ProjectSettings
  palette: ProjectPaletteSlot[]
}

export const PROJECT_APP = 'hueforge-web'
export const PROJECT_VERSION = 1
export const PROJECT_EXTENSION = '.hueforge.json'
const HEX_RE = /^#[0-9a-f]{6}$/i

/** Raised when a file is not a valid HueForge project; `message` is technical. */
export class ProjectFileError extends Error {
  constructor(detail: string) {
    super(`Invalid project file: ${detail}`)
    this.name = 'ProjectFileError'
  }
}

export function buildProjectFile(input: {
  imageName: string
  dataUrl: string
  settings: ProjectSettings
  palette: ProjectPaletteSlot[]
}): ProjectFile {
  return {
    app: PROJECT_APP,
    version: PROJECT_VERSION,
    image: { name: input.imageName, dataUrl: input.dataUrl },
    settings: { ...input.settings },
    palette: input.palette.map((s) => ({
      hex: s.hex,
      tauMm: s.tauMm,
      ...(s.filamentId ? { filamentId: s.filamentId } : {}),
      ...(s.filament ? { filament: { ...s.filament } } : {}),
    })),
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function parsePalette(raw: unknown): ProjectPaletteSlot[] {
  if (!Array.isArray(raw) || raw.length < 1) throw new ProjectFileError('palette must be a non-empty array')
  return raw.map((item, i) => {
    if (!isRecord(item)) throw new ProjectFileError(`palette[${i}] must be an object`)
    const hex = str(item.hex)
    if (!hex || !HEX_RE.test(hex)) throw new ProjectFileError(`palette[${i}].hex must be #rrggbb`)
    if (!isFiniteNumber(item.tauMm) || item.tauMm <= 0) throw new ProjectFileError(`palette[${i}].tauMm must be a positive number`)
    let filamentId: string | undefined
    let filament: EmbeddedFilament | undefined
    if (item.filamentId !== undefined) {
      const id = str(item.filamentId)
      if (!id) throw new ProjectFileError(`palette[${i}].filamentId must be a string`)
      filamentId = id
    }
    if (item.filament !== undefined) {
      if (!isRecord(item.filament)) throw new ProjectFileError(`palette[${i}].filament must be an object`)
      const id = str(item.filament.id)
      const nameRu = str(item.filament.nameRu) ?? ''
      const nameEn = str(item.filament.nameEn) ?? nameRu
      const fhex = str(item.filament.hex)
      const materialId = str(item.filament.materialId)
      if (!id || !fhex || !HEX_RE.test(fhex) || !materialId) {
        throw new ProjectFileError(`palette[${i}].filament is incomplete`)
      }
      filament = { id, nameRu, nameEn, hex: fhex.toLowerCase(), materialId }
    }
    return { hex: hex.toLowerCase(), tauMm: item.tauMm, ...(filamentId ? { filamentId } : {}), ...(filament ? { filament } : {}) }
  })
}

/** Parse and validate a project file; throws ProjectFileError on any issue. */
export function parseProjectFile(text: string): ProjectFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ProjectFileError('not valid JSON')
  }
  if (!isRecord(raw)) throw new ProjectFileError('top level must be an object')
  if (raw.app !== PROJECT_APP) throw new ProjectFileError(`app must be "${PROJECT_APP}"`)
  if (raw.version !== PROJECT_VERSION) throw new ProjectFileError('unsupported version')
  if (!isRecord(raw.image)) throw new ProjectFileError('image must be an object')
  const imageName = str(raw.image.name)
  const dataUrl = str(raw.image.dataUrl)
  if (!imageName || !dataUrl || !dataUrl.startsWith('data:image/')) {
    throw new ProjectFileError('image must carry a name and a data:image URL')
  }
  if (!isRecord(raw.settings)) throw new ProjectFileError('settings must be an object')
  const s = raw.settings
  const num = (k: string): number => {
    if (!isFiniteNumber(s[k])) throw new ProjectFileError(`settings.${k} must be a finite number`)
    return s[k] as number
  }
  const bool = (k: string): boolean => {
    if (typeof s[k] !== 'boolean') throw new ProjectFileError(`settings.${k} must be a boolean`)
    return s[k] as boolean
  }
  const settings: ProjectSettings = {
    colors: num('colors'),
    widthMm: num('widthMm'),
    heightMm: num('heightMm'),
    baseMm: num('baseMm'),
    maxMm: num('maxMm'),
    layerMm: num('layerMm'),
    dither: num('dither'),
    darkIsTall: bool('darkIsTall'),
    backlight: bool('backlight'),
  }
  // Optional ΔE merge threshold: 0..40; absent = off (older project files).
  if (s.mergeDeltaE !== undefined) {
    if (!isFiniteNumber(s.mergeDeltaE) || (s.mergeDeltaE as number) < 0 || (s.mergeDeltaE as number) > 40) {
      throw new ProjectFileError('settings.mergeDeltaE must be a number in 0..40')
    }
    settings.mergeDeltaE = s.mergeDeltaE as number
  }
  // Optional per-band thicknesses: one positive finite number per color.
  if (s.bandHeightsMm !== undefined) {
    if (
      !Array.isArray(s.bandHeightsMm) ||
      s.bandHeightsMm.length !== settings.colors ||
      !s.bandHeightsMm.every((h) => isFiniteNumber(h) && (h as number) > 0)
    ) {
      throw new ProjectFileError('settings.bandHeightsMm must have one positive finite number per color')
    }
    settings.bandHeightsMm = [...(s.bandHeightsMm as number[])]
  }
  return {
    app: PROJECT_APP,
    version: PROJECT_VERSION,
    image: { name: imageName, dataUrl },
    settings,
    palette: parsePalette(raw.palette),
  }
}