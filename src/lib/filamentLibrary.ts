import type { RGB } from './types'
import { hexToRgb } from './palette'

/**
 * Filament library of Russian manufacturers — the 8 most prolific brands
 * ranked by the 3dtoday.ru survey of RF FDM filament producers (U3Print →
 * CyberFiber), plus НИТ (PK NIT, Volgograd, since 2014; PLA/PETG/ABS/HIPS/TPU
 * with BASIC/MATTE/SILK/PASTEL lines). Every brand offers the common colors;
 * per-brand palettes reflect what each one actually sells. Hex values are
 * close approximations of the catalog color names — printers and monitor
 * gamuts vary, so treat them as a starting point, then fine-tune with the
 * palette color picker.
 *
 * Users can also add their own filaments ("My filaments"); those are stored
 * in localStorage and merged into the library at lookup time.
 */

export interface FilamentBrand {
  /** Stable id, also used in i18n keys. */
  id: string
  /** Brand display name (Latin spelling, not translated). */
  name: string
  /** City of production. */
  city: string
  /** Brand website. */
  site: string
}

export interface FilamentColor {
  /** Stable id within the brand (`<brand>:<material>:<colorId>`). */
  id: string
  /** Russian catalog name (also shown for en, transliteration is worse). */
  nameRu: string
  nameEn: string
  hex: string
  rgb: RGB
}

export interface FilamentMaterial {
  /** Material type id (pla, petg, abs…). */
  id: string
  name: string
  colors: FilamentColor[]
}

/** The material types the library carries colors for. */
export const MATERIALS = ['pla', 'petg', 'abs'] as const
export type MaterialId = (typeof MATERIALS)[number]

const MATERIAL_NAMES: Record<MaterialId, string> = {
  pla: 'PLA',
  petg: 'PETG',
  abs: 'ABS',
}

export function materialName(id: MaterialId): string {
  return MATERIAL_NAMES[id]
}

export const BRANDS: FilamentBrand[] = [
  { id: 'u3print', name: 'U3Print', city: 'Новосибирск', site: 'https://u3print.ru' },
  { id: 'filamentarno', name: 'Filamentarno!', city: 'Новосибирск', site: 'https://filamentarno.ru' },
  { id: 'rec', name: 'REC', city: 'Москва', site: 'https://rec3d.ru' },
  { id: 'lider3d', name: 'Lider-3D', city: 'Москва', site: 'https://lider-3d.ru' },
  { id: 'bestfilament', name: 'Bestfilament', city: 'Томск', site: 'https://bestfilament.ru' },
  { id: '3dclub', name: '3D Club', city: 'Москва', site: 'https://3dclub.ru' },
  { id: 'printproduct', name: 'Print Product', city: 'Санкт-Петербург', site: 'https://printproduct3d.ru' },
  { id: 'cyberfiber', name: 'CyberFiber', city: 'Москва', site: 'https://cyberfiber.ru' },
  { id: 'nit', name: 'НИТ', city: 'Волгоград', site: 'https://plastik-nit.ru' },
]

/** Pseudo-brand id for user-added filaments. */
export const CUSTOM_BRAND_ID = 'my'
/** Composite-id prefix guard: custom ids look like `my:<material>:<uid>`. */
const CUSTOM_PREFIX = `${CUSTOM_BRAND_ID}:`

interface ColorSpec {
  id: string
  ru: string
  en: string
  hex: string
}

/** Colors every stocked brand sells (the common 16 of the Russian market). */
const COMMON: ColorSpec[] = [
  { id: 'white', ru: 'Белый', en: 'White', hex: '#f2f2f0' },
  { id: 'black', ru: 'Чёрный', en: 'Black', hex: '#1c1c1e' },
  { id: 'red', ru: 'Красный', en: 'Red', hex: '#c22a24' },
  { id: 'blue', ru: 'Синий', en: 'Blue', hex: '#1e4fae' },
  { id: 'yellow', ru: 'Жёлтый', en: 'Yellow', hex: '#f2c814' },
  { id: 'green', ru: 'Зелёный', en: 'Green', hex: '#2e8b3d' },
  { id: 'orange', ru: 'Оранжевый', en: 'Orange', hex: '#e8721c' },
  { id: 'gray', ru: 'Серый', en: 'Gray', hex: '#8a8d90' },
  { id: 'lightgray', ru: 'Светло-серый', en: 'Light gray', hex: '#c3c6c9' },
  { id: 'darkgray', ru: 'Тёмно-серый', en: 'Dark gray', hex: '#4c4f52' },
  { id: 'natural', ru: 'Натуральный', en: 'Natural', hex: '#e8e2d2' },
  { id: 'skyblue', ru: 'Голубой', en: 'Sky blue', hex: '#7db8e8' },
  { id: 'pink', ru: 'Розовый', en: 'Pink', hex: '#e88fb0' },
  { id: 'purple', ru: 'Фиолетовый', en: 'Purple', hex: '#6a3fa0' },
  { id: 'brown', ru: 'Коричневый', en: 'Brown', hex: '#7a4a28' },
  { id: 'salad', ru: 'Салатовый', en: 'Light green', hex: '#a8d84c' },
]

/** Bestfilament extras (from their catalog). */
const BF_EXTRA: ColorSpec[] = [
  { id: 'emerald', ru: 'Изумрудный', en: 'Emerald', hex: '#17805c' },
  { id: 'coral', ru: 'Коралловый', en: 'Coral', hex: '#f26d5f' },
  { id: 'cream', ru: 'Кремовый', en: 'Cream', hex: '#efe3c8' },
  { id: 'chocolate', ru: 'Шоколадный', en: 'Chocolate', hex: '#54331f' },
  { id: 'khaki', ru: 'Хаки', en: 'Khaki', hex: '#8b8a5c' },
  { id: 'lilac', ru: 'Сиреневый', en: 'Lilac', hex: '#9a7fc0' },
  { id: 'fire', ru: 'Огненный', en: 'Fire', hex: '#d93a1f' },
  { id: 'silver', ru: 'Серебристый металлик', en: 'Silver metallic', hex: '#b8bcc0' },
  { id: 'gold', ru: 'Золотистый металлик', en: 'Gold metallic', hex: '#c9a24b' },
]

/** Print Product extras (PLA/ABS Geo palette). */
const PP_EXTRA: ColorSpec[] = [
  { id: 'turquoise', ru: 'Бирюзовый', en: 'Turquoise', hex: '#2aa8a0' },
  { id: 'bordeaux', ru: 'Бордовый', en: 'Bordeaux', hex: '#7a1f2b' },
  { id: 'lilacpp', ru: 'Сиреневый', en: 'Lilac', hex: '#9a7fc0' },
  { id: 'carrot', ru: 'Оранжевая морковь', en: 'Carrot orange', hex: '#e06a1a' },
  { id: 'brick', ru: 'Оранжевый кирпич', en: 'Brick orange', hex: '#b8501f' },
  { id: 'aluminum', ru: 'Алюминий', en: 'Aluminum', hex: '#a9adb2' },
]

/** Filamentarno! extras (their signature PLA+ and designer colors). */
const FA_EXTRA: ColorSpec[] = [
  { id: 'plaplus', ru: 'PLA+ серый', en: 'PLA+ gray', hex: '#9b9c9e' },
  { id: 'ceramo', ru: 'Керамика', en: 'Ceramo', hex: '#d8cfc0' },
  { id: 'buratino', ru: 'Буратино', en: 'Buratino gold', hex: '#c9862f' },
  { id: 'granite', ru: 'Гранит', en: 'Granite', hex: '#3c3e40' },
]

/** НИТ extras (signature colors from the plastik-nit.ru catalog). */
const NIT_EXTRA: ColorSpec[] = [
  { id: 'beige', ru: 'Бежевый', en: 'Beige', hex: '#e6d5b8' },
  { id: 'bluemetallic', ru: 'Синий металлик', en: 'Blue metallic', hex: '#2e5f8a' },
  { id: 'silvernit', ru: 'Серебристый металлик', en: 'Silver metallic', hex: '#b8bcc0' },
]

function colorOf(brand: string, material: string, spec: ColorSpec): FilamentColor {
  return {
    id: `${brand}:${material}:${spec.id}`,
    nameRu: spec.ru,
    nameEn: spec.en,
    hex: spec.hex,
    rgb: hexToRgb(spec.hex),
  }
}

function materialsFor(brand: string, extra: ColorSpec[]): Record<MaterialId, FilamentMaterial> {
  const all = [...COMMON, ...extra]
  const mk = (id: MaterialId): FilamentMaterial => ({
    id,
    name: MATERIAL_NAMES[id],
    colors: all.map((spec) => colorOf(brand, id, spec)),
  })
  return { pla: mk('pla'), petg: mk('petg'), abs: mk('abs') }
}

/** brandId → material → colors, the full static library. */
export const LIBRARY: Record<string, Record<MaterialId, FilamentMaterial>> = {
  u3print: materialsFor('u3print', []),
  filamentarno: materialsFor('filamentarno', FA_EXTRA),
  rec: materialsFor('rec', []),
  lider3d: materialsFor('lider3d', []),
  bestfilament: materialsFor('bestfilament', BF_EXTRA),
  '3dclub': materialsFor('3dclub', []),
  printproduct: materialsFor('printproduct', PP_EXTRA),
  cyberfiber: materialsFor('cyberfiber', []),
  nit: materialsFor('nit', NIT_EXTRA),
}

// ---- Custom filaments ("My filaments") -----------------------------------

const STORAGE_KEY = 'hf-custom-filaments'

/** A user-defined filament, stored in localStorage. */
export interface CustomFilament {
  /** Unique id: `my:<material>:<uid>`. */
  id: string
  nameRu: string
  nameEn: string
  hex: string
  rgb: RGB
  materialId: MaterialId
}

/** Read the user's saved filaments (empty array when none or unavailable). */
export function loadCustomFilaments(): CustomFilament[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: CustomFilament[] = []
    for (const item of parsed) {
      const f = item as Partial<CustomFilament>
      if (
        typeof f.id === 'string' && f.id.startsWith(CUSTOM_PREFIX) &&
        typeof f.nameRu === 'string' && f.nameRu.length > 0 &&
        typeof f.hex === 'string' && /^#[0-9a-f]{6}$/i.test(f.hex) &&
        MATERIALS.includes(f.materialId as MaterialId)
      ) {
        out.push({ ...f, nameEn: f.nameEn || f.nameRu, rgb: hexToRgb(f.hex) } as CustomFilament)
      }
    }
    return out
  } catch {
    return [] // private mode / corrupted data
  }
}

function saveCustomFilaments(list: CustomFilament[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* private mode: customs live only for the session */
  }
}

let customCache: CustomFilament[] = loadCustomFilaments()

/** Add a user filament; returns the stored record (with resolved rgb). */
export function addCustomFilament(input: { name: string; hex: string; materialId: MaterialId }): CustomFilament {
  const uid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  const record: CustomFilament = {
    id: `${CUSTOM_PREFIX}${input.materialId}:${uid}`,
    nameRu: input.name.trim() || 'Мой филамент',
    nameEn: input.name.trim() || 'My filament',
    hex: input.hex.toLowerCase(),
    rgb: hexToRgb(input.hex),
    materialId: input.materialId,
  }
  customCache = [...customCache, record]
  saveCustomFilaments(customCache)
  return record
}

/**
 * Register a user filament record (e.g. embedded in a loaded project) unless
 * it already exists; returns true when it was added. The id is preserved so
 * existing project assignments keep working.
 */
export function restoreCustomFilament(record: CustomFilament): boolean {
  if (customCache.some((f) => f.id === record.id)) return false
  const clean: CustomFilament = {
    id: record.id,
    nameRu: record.nameRu || 'Мой филамент',
    nameEn: record.nameEn || record.nameRu || 'My filament',
    hex: record.hex.toLowerCase(),
    rgb: hexToRgb(record.hex),
    materialId: record.materialId,
  }
  customCache = [...customCache, clean]
  saveCustomFilaments(customCache)
  return true
}

/** Remove a user filament by id; returns true when something was removed. */
export function removeCustomFilament(id: string): boolean {
  const before = customCache.length
  customCache = customCache.filter((f) => f.id !== id)
  if (customCache.length !== before) saveCustomFilaments(customCache)
  return customCache.length !== before
}

/** All user filaments (the live list, not a copy of the cache). */
export function customFilaments(): CustomFilament[] {
  return customCache
}

export interface LibraryChoice {
  brandId: string
  brandName: string
  materialId: MaterialId
  color: FilamentColor
}

/** Is this composite id one of the user's own filaments? */
export function isCustomId(id: string): boolean {
  return id.startsWith(CUSTOM_PREFIX)
}

/** Flat list of every (brand, material, color) combination, customs last. */
export function allFilaments(): LibraryChoice[] {
  const out: LibraryChoice[] = []
  for (const brand of BRANDS) {
    for (const materialId of MATERIALS) {
      for (const color of LIBRARY[brand.id][materialId].colors) {
        out.push({ brandId: brand.id, brandName: brand.name, materialId, color })
      }
    }
  }
  for (const f of customCache) {
    out.push({
      brandId: CUSTOM_BRAND_ID,
      brandName: 'My filaments',
      materialId: f.materialId,
      color: { id: f.id, nameRu: f.nameRu, nameEn: f.nameEn, hex: f.hex, rgb: f.rgb },
    })
  }
  return out
}

/** Look up one filament by its composite id (`brand:material:colorId`). */
export function findFilament(id: string): LibraryChoice | undefined {
  if (isCustomId(id)) {
    const f = customCache.find((c) => c.id === id)
    return f
      ? { brandId: CUSTOM_BRAND_ID, brandName: 'My filaments', materialId: f.materialId, color: { id: f.id, nameRu: f.nameRu, nameEn: f.nameEn, hex: f.hex, rgb: f.rgb } }
      : undefined
  }
  const [brandId, materialId] = id.split(':')
  const material = LIBRARY[brandId]?.[materialId as MaterialId]
  const color = material?.colors.find((c) => c.id === id)
  return color ? { brandId, brandName: BRANDS.find((b) => b.id === brandId)?.name ?? brandId, materialId: materialId as MaterialId, color } : undefined
}

/**
 * Nearest library filament for an RGB color (redmean distance). The palette
 * legend uses this to suggest what to buy; `excludeIds` skips choices already
 * used by other bands so N bands suggest N different filaments.
 */
export function nearestLibraryFilament(c: RGB, excludeIds: string[] = []): LibraryChoice {
  const skip = new Set(excludeIds)
  let best = allFilaments()[0]
  let bestDist = Infinity
  for (const f of allFilaments()) {
    if (skip.has(f.color.id)) continue
    const dr = f.color.rgb.r - c.r
    const dg = f.color.rgb.g - c.g
    const db = f.color.rgb.b - c.b
    const d = dr * dr + dg * dg + db * db
    if (d < bestDist) {
      bestDist = d
      best = f
    }
  }
  return best
}
