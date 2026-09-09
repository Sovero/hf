import { findFilament } from './filamentLibrary'

/**
 * Recently-picked spools for the "Build from catalog" dialog — the row of
 * swatches above the grid so a returning user's usual filaments are one
 * click away. Order is most-recently-used first; capped so the row stays
 * one line. Stored in localStorage like the custom filaments; tests run in
 * node, where the in-memory cache still works.
 */

const STORAGE_KEY = 'hf-recent-spools'
const MAX_RECENT = 12

let cache: string[] | null = null

function load(): string[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    cache = [] // private mode / corrupted data
  }
  return cache
}

function save(ids: string[]): void {
  cache = ids
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    /* private mode: recents live only for the session */
  }
}

/** Most-recently-used spool ids, capped. Only ids that still resolve. */
export function recentSpoolIds(): string[] {
  return load().filter((id) => findFilament(id) !== undefined)
}

/** Prepend `ids` to the recents (deduped, capped, newest first). */
export function recordRecentSpools(ids: string[]): void {
  const next: string[] = []
  for (const id of [...ids, ...load()]) {
    if (!next.includes(id)) next.push(id)
    if (next.length >= MAX_RECENT) break
  }
  save(next)
}

/** Forget everything (also used by tests). */
export function clearRecentSpools(): void {
  save([])
}
