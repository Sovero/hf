import type { RGB } from './types'
import { allFilaments, type LibraryChoice } from './filamentLibrary'

/** Weighted-RGB (redmean) squared distance — the app's palette metric. */
export function redmeanDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  const rm = (a.r + b.r) / 2
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db
}

export interface AutoPickResult {
  /** Composite filament id per palette slot, in palette order. */
  ids: (string | null)[]
  /** Best-match library choice per palette slot (parallel to ids). */
  choices: (LibraryChoice | null)[]
  /** Redmean distance of each match (Infinity = no suggestion). */
  distances: number[]
}

/**
 * Suggest a real filament for every palette color. All (slot, spool) pairs
 * are sorted by redmean distance and taken greedily: a pair is accepted only
 * if both the slot and the spool are still free, so every slot gets a
 * distinct filament — the globally closest combination. Customs (from the
 * user's library) participate alongside brand filaments.
 */
export function autoPickFilaments(palette: RGB[]): AutoPickResult {
  const lib = allFilaments()
  const pairs: { slot: number; f: LibraryChoice; d: number }[] = []
  for (let i = 0; i < palette.length; i++) {
    for (const f of lib) {
      pairs.push({ slot: i, f, d: redmeanDistance(palette[i], f.color.rgb) })
    }
  }
  pairs.sort((a, b) => a.d - b.d || a.slot - b.slot)

  const slotTaken = new Array(palette.length).fill(false)
  const spoolTaken = new Set<string>()
  const chosen: (LibraryChoice | null)[] = new Array(palette.length).fill(null)
  const dist: number[] = new Array(palette.length).fill(Infinity)

  for (const p of pairs) {
    if (slotTaken[p.slot] || spoolTaken.has(p.f.color.id)) continue
    slotTaken[p.slot] = true
    spoolTaken.add(p.f.color.id)
    chosen[p.slot] = p.f
    dist[p.slot] = p.d
    if (slotTaken.every(Boolean)) break
  }

  return {
    ids: chosen.map((c) => (c ? c.color.id : null)),
    choices: chosen,
    distances: dist,
  }
}
