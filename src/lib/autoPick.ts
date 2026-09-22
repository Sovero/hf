import type { RGB } from './types'
import { allFilaments, type LibraryChoice } from './filamentLibrary'
import { deltaE2000Rgb } from './deltae'

/**
 * Cheap green-weighted squared RGB metric (redmean). The auto-pick itself
 * scores with CIEDE2000 — this stays for callers that only need a fast
 * squared-distance ranking.
 */
export function redmeanDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  const rm = (a.r + b.r) / 2
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db
}

/**
 * Two spool colors closer than this (CIEDE2000) are treated as one color, so
 * a palette never spends two slots — and two filament swaps — on filaments the
 * eye reads as the same tone. The catalog's own colors sit at 2.5 and above.
 */
export const PICK_MIN_DELTA_E = 2.5

/**
 * What a sliver keeps of the largest color's weight. A color covering a
 * fraction of a percent is still visible in the print, so it is never ignored
 * outright when a spool is contested — it just loses the argument to the
 * region that covers a fifth of the picture.
 */
const MIN_WEIGHT = 0.05

export interface AutoPickOptions {
  /**
   * Per-slot importance, e.g. the share of the print each color covers
   * (see `colorShares`). Weights are normalized by their maximum and floored
   * at {@link MIN_WEIGHT}; equal by default.
   */
  weights?: readonly number[]
  /**
   * Ordered ids the user actually has — their own filaments first, then
   * recently used spools. Between two spools of the same color the earlier
   * one wins.
   */
  preferredIds?: readonly string[]
  /** Distinctness threshold in CIEDE2000; defaults to {@link PICK_MIN_DELTA_E}. */
  minDeltaE?: number
  /** Catalog to pick from; defaults to the brand library plus custom filaments. */
  library?: readonly LibraryChoice[]
}

export interface AutoPickResult {
  /** Composite filament id per palette slot, in palette order. */
  ids: (string | null)[]
  /** Best-match library entry per palette slot (parallel to ids). */
  choices: (LibraryChoice | null)[]
  /** CIEDE2000 of each match (Infinity = no suggestion). */
  distances: number[]
  /** How many of the chosen spools differ from each other in color. */
  distinctColors: number
}

interface ColorGroup {
  hex: string
  rgb: RGB
  entries: LibraryChoice[]
}

/**
 * Suggest a real catalog spool for every palette color.
 *
 * The pick works on spool *colors*, not on catalog entries: the library holds
 * the same tone under many brands and materials, so picking entries greadily
 * can hand two palette slots two spools that print as one color. Instead:
 *
 * 1. catalog entries are grouped by color and those colors are clustered at
 *    {@link PICK_MIN_DELTA_E}, so every candidate column is a visually
 *    distinct tone;
 * 2. the slots are matched to distinct clusters by an exact minimum-cost
 *    assignment (weights per slot, CIEDE2000 costs), which — unlike greedy —
 *    guarantees the region covering a fifth of the print is not left with a
 *    spool that a sliver snatched;
 * 3. each slot then takes the best-fitting color of its cluster, and that
 *    color's spool: the user's own filament when they have one, otherwise the
 *    first catalog entry (deterministic).
 *
 * Colors always come from the palette as given, so the pick works the same
 * for HueForge-style luminance bands and for the median-cut palette of
 * "by image colors" — in the latter it matches the real spools to the tones
 * the picture actually contains.
 */
export function autoPickFilaments(palette: RGB[], options: AutoPickOptions = {}): AutoPickResult {
  const n = palette.length
  if (n === 0) return { ids: [], choices: [], distances: [], distinctColors: 0 }

  const lib = options.library ?? allFilaments()
  const groups = groupByColor(lib)
  if (groups.length === 0) {
    return {
      ids: new Array(n).fill(null),
      choices: new Array(n).fill(null),
      distances: new Array(n).fill(Infinity),
      distinctColors: 0,
    }
  }

  const columns = candidateColumns(groups, clusterGroups(groups, options.minDeltaE ?? PICK_MIN_DELTA_E), n)
  const weights = normalizeWeights(options.weights, n)
  const costs = palette.map((p, i) =>
    columns.map((members) => {
      let best = Infinity
      for (const gi of members) best = Math.min(best, colorDistance(p, groups[gi].rgb))
      return best * weights[i]
    }),
  )

  const assignment = minCostAssignment(costs)
  const prefRank = rankPreferred(options.preferredIds)
  const choices: (LibraryChoice | null)[] = []
  const distances: number[] = []
  const usedColors = new Set<string>()

  for (let i = 0; i < n; i++) {
    const members = columns[assignment[i] ?? 0] ?? [0]
    let bestGroup = members[0]
    let bestD = colorDistance(palette[i], groups[bestGroup].rgb)
    for (const gi of members) {
      const d = colorDistance(palette[i], groups[gi].rgb)
      if (d < bestD - 1e-12) {
        bestGroup = gi
        bestD = d
      }
    }
    choices.push(pickEntry(groups[bestGroup], prefRank))
    distances.push(bestD)
    usedColors.add(groups[bestGroup].hex)
  }

  return {
    ids: choices.map((c) => (c ? c.color.id : null)),
    choices,
    distances,
    distinctColors: usedColors.size,
  }
}

/**
 * Exact minimum-cost assignment for a rectangular cost matrix (rows ≤ cols),
 * Hungarian / Jonker-Volgenant shortest augmenting paths: every row gets its
 * own column and the total cost is minimal — not merely greedy-minimal. Runs
 * in O(rows² · cols), which for a palette (≤ a handful of rows) and a catalog
 * (tens of columns) is microseconds. Costs must be finite.
 */
export function minCostAssignment(cost: readonly (readonly number[])[]): number[] {
  const n = cost.length
  if (n === 0) return []
  const m = cost[0].length
  if (m < n) throw new Error(`minCostAssignment needs at least as many columns as rows (${m} < ${n})`)

  const u = new Array(n + 1).fill(0)
  const v = new Array(m + 1).fill(0)
  const matchRow = new Array(m + 1).fill(0)
  const way = new Array(m + 1).fill(0)

  for (let i = 1; i <= n; i++) {
    matchRow[0] = i
    let j0 = 0
    const minv = new Array(m + 1).fill(Infinity)
    const used = new Array(m + 1).fill(false)
    do {
      used[j0] = true
      const i0 = matchRow[j0]
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[matchRow[j]] += delta
          v[j] -= delta
        } else {
          minv[j] -= delta
        }
      }
      j0 = j1
    } while (matchRow[j0] !== 0)
    do {
      const j1 = way[j0]
      matchRow[j0] = matchRow[j1]
      j0 = j1
    } while (j0)
  }

  const result = new Array(n).fill(0)
  for (let j = 1; j <= m; j++) {
    if (matchRow[j] > 0) result[matchRow[j] - 1] = j - 1
  }
  return result
}

function colorDistance(a: RGB, b: RGB): number {
  return deltaE2000Rgb(a.r, a.g, a.b, b.r, b.g, b.b)
}

/** Catalog entries grouped by exact color, in library order (customs last). */
function groupByColor(lib: readonly LibraryChoice[]): ColorGroup[] {
  const byHex = new Map<string, ColorGroup>()
  for (const f of lib) {
    const hex = f.color.hex.toLowerCase()
    const group = byHex.get(hex)
    if (group) group.entries.push(f)
    else byHex.set(hex, { hex, rgb: f.color.rgb, entries: [f] })
  }
  return [...byHex.values()]
}

/** Group indices bucketed into colors that are visually the same spool. */
function clusterGroups(groups: ColorGroup[], minDeltaE: number): number[][] {
  const parent = groups.map((_, i) => i)
  const find = (x: number): number => {
    let root = x
    while (parent[root] !== root) root = parent[root]
    let cur = x
    while (parent[cur] !== cur) {
      const next = parent[cur]
      parent[cur] = root
      cur = next
    }
    return root
  }
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (colorDistance(groups[i].rgb, groups[j].rgb) < minDeltaE) parent[find(i)] = find(j)
    }
  }
  const buckets = new Map<number, number[]>()
  for (let i = 0; i < groups.length; i++) {
    const root = find(i)
    const bucket = buckets.get(root)
    if (bucket) bucket.push(i)
    else buckets.set(root, [i])
  }
  return [...buckets.values()]
}

/**
 * Columns for the assignment: one per visually distinct color cluster. When
 * the catalog cannot even fill the palette with distinct tones, every single
 * color becomes a column and the list is padded with repeats — duplicates are
 * then unavoidable, and the print simply gets the closest tone twice.
 */
function candidateColumns(groups: ColorGroup[], clusters: number[][], n: number): number[][] {
  const columns = clusters.length >= n ? clusters : groups.map((_, i) => [i])
  for (let i = 0; columns.length < n; i++) columns.push([i % groups.length])
  return columns
}

/** Relative slot importance in {@link MIN_WEIGHT}..1, all equal by default. */
function normalizeWeights(weights: readonly number[] | undefined, n: number): number[] {
  if (!weights || weights.length !== n) return new Array(n).fill(1)
  const usable = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0))
  const max = Math.max(...usable)
  if (max <= 0) return new Array(n).fill(1)
  return usable.map((w) => Math.max(w, max * MIN_WEIGHT) / max)
}

/** Earlier id in the list ranks higher; unknown ids rank last. */
function rankPreferred(ids: readonly string[] | undefined): Map<string, number> {
  const rank = new Map<string, number>()
  ids?.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i)
  })
  return rank
}

/** The user's own spool of this color if they have one, else the first entry. */
function pickEntry(group: ColorGroup, prefRank: Map<string, number>): LibraryChoice {
  let best = group.entries[0]
  let bestRank = prefRank.get(best.color.id) ?? Infinity
  for (const f of group.entries) {
    const rank = prefRank.get(f.color.id) ?? Infinity
    if (rank < bestRank) {
      best = f
      bestRank = rank
    }
  }
  return best
}
