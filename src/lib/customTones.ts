import { TONE_CONTRAST_MAX, TONE_CONTRAST_MIN, TONE_POWER_MAX, TONE_POWER_MIN } from './quantize'

/**
 * User-saved relief styles («my styles»).
 *
 * The four built-in styles cover the usual looks, but the interesting setting
 * is often the one the auto-fit or a hand tweak produced. Saving it under a name
 * turns that setting into something reusable — and, because the list is stored
 * in the project file as well, a shared project carries its styles with it.
 *
 * Values are **percent on the two sliders** (100 = the picture's own tones),
 * the same numbers the project file, the UI and the metadata use; the pipeline
 * divides by 100 when it needs the multipliers.
 *
 * Pure list helpers (create/remove/lookup) are separated from the persistence
 * wrappers so the rules are unit-testable without a browser.
 */
export interface CustomTone {
  id: string
  name: string
  /** Relief contrast in percent (0..300). */
  contrast: number
  /** Detail deepening in percent (20..300). */
  power: number
}

/** Longest style name kept; longer input is cut, not rejected. */
export const MAX_TONE_NAME = 40

/**
 * How many styles the editor will save. A guard for the panel, not a data
 * rule: a project may carry more (they load and render fine), and the save
 * button explains itself when the limit is reached.
 */
export const MAX_CUSTOM_TONES = 24

const STORAGE_KEY = 'hf-custom-tones'

const CONTRAST_MIN = TONE_CONTRAST_MIN * 100
const CONTRAST_MAX = TONE_CONTRAST_MAX * 100
const POWER_MIN = TONE_POWER_MIN * 100
const POWER_MAX = TONE_POWER_MAX * 100

const isPercent = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

/** True for a record the editor can use: id, name and both values in range. */
export function isCustomTone(v: unknown): v is CustomTone {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Partial<CustomTone>
  return (
    typeof t.id === 'string' &&
    t.id.length > 0 &&
    typeof t.name === 'string' &&
    normalizeToneName(t.name).length > 0 &&
    isPercent(t.contrast, CONTRAST_MIN, CONTRAST_MAX) &&
    isPercent(t.power, POWER_MIN, POWER_MAX)
  )
}

/** Trim, collapse inner whitespace and cut to the length the panel can show. */
export function normalizeToneName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_TONE_NAME)
}

/** Stable id for a new style; only uniqueness matters, not the shape. */
function newToneId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Copy of one record. Every helper hands out copies, so a caller that edits
 * what it received (the UI does mutate nothing, but a test or a future
 * caller might) can never corrupt the stored list.
 */
const cloneTone = (t: CustomTone): CustomTone => ({ ...t })

/** Copy of a list, records included. */
const cloneList = (list: readonly CustomTone[]): CustomTone[] => list.map(cloneTone)

export type ToneAddStatus = 'added' | 'duplicate' | 'full' | 'invalid'

export interface ToneAddResult {
  status: ToneAddStatus
  /** The stored style: the new one, or the existing identical one. */
  tone: CustomTone | null
  list: CustomTone[]
}

/**
 * Add a style to a list. A setting that is already saved is not saved twice —
 * the existing record comes back as `duplicate`, so the caller can point at it
 * instead of creating a second chip with the same numbers.
 */
export function createCustomTone(
  list: readonly CustomTone[],
  input: { name: string; contrast: number; power: number },
): ToneAddResult {
  const name = normalizeToneName(input.name)
  if (name.length === 0 || !isPercent(input.contrast, CONTRAST_MIN, CONTRAST_MAX) || !isPercent(input.power, POWER_MIN, POWER_MAX)) {
    return { status: 'invalid', tone: null, list: cloneList(list) }
  }
  const existing = toneForValues(list, input.contrast, input.power)
  if (existing) return { status: 'duplicate', tone: existing, list: cloneList(list) }
  if (list.length >= MAX_CUSTOM_TONES) return { status: 'full', tone: null, list: cloneList(list) }
  const tone: CustomTone = { id: newToneId(), name, contrast: input.contrast, power: input.power }
  return { status: 'added', tone: cloneTone(tone), list: [...cloneList(list), tone] }
}

/** Drop a style by id; `removed` is null when the id was not in the list. */
export function removeToneFrom(list: readonly CustomTone[], id: string): { list: CustomTone[]; removed: CustomTone | null } {
  const removed = list.find((t) => t.id === id) ?? null
  if (!removed) return { list: cloneList(list), removed: null }
  return { list: list.filter((t) => t.id !== id).map(cloneTone), removed: cloneTone(removed) }
}

/** The saved style with exactly these values, if any. */
export function toneForValues(
  list: readonly CustomTone[],
  contrast: number,
  power: number,
  epsilon = 1e-9,
): CustomTone | null {
  const found = list.find((t) => Math.abs(t.contrast - contrast) <= epsilon && Math.abs(t.power - power) <= epsilon)
  return found ? cloneTone(found) : null
}

/** Read the saved styles, skipping anything malformed (or unavailable storage). */
export function loadCustomTones(): CustomTone[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isCustomTone).map((t) => ({ ...t, name: normalizeToneName(t.name) }))
  } catch {
    return [] // private mode / corrupted data
  }
}

function saveCustomTones(list: CustomTone[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* private mode: the styles live for this session only */
  }
}

let cache: CustomTone[] = loadCustomTones()

/** The saved styles of this browser (a copy: the caller cannot mutate them). */
export function customTones(): CustomTone[] {
  return cloneList(cache)
}

/** Save a style: the list is updated and written to localStorage. */
export function addCustomTone(input: { name: string; contrast: number; power: number }): ToneAddResult {
  const result = createCustomTone(cache, input)
  if (result.status === 'added') {
    cache = result.list
    saveCustomTones(cache)
  }
  return result
}

/** Delete a saved style; returns the removed record, or null if unknown. */
export function removeCustomTone(id: string): CustomTone | null {
  const { list, removed } = removeToneFrom(cache, id)
  if (removed) {
    cache = list
    saveCustomTones(cache)
  }
  return removed
}

/**
 * Register a style carried by a project file. The id is preserved so a project
 * loaded on another machine keeps the same chips; a style with that id is left
 * untouched and reported as not added.
 */
export function restoreCustomTone(record: CustomTone): boolean {
  if (!isCustomTone(record)) return false
  if (cache.some((t) => t.id === record.id)) return false
  const clean: CustomTone = { ...record, name: normalizeToneName(record.name) }
  cache = [...cache, clean]
  saveCustomTones(cache)
  return true
}

/** Forget every saved style (used by tests; the UI has no such button). */
export function clearCustomTones(): void {
  cache = []
  saveCustomTones(cache)
}
