import type { RGB } from './types'

/**
 * Drop palette colors whose share of the printed area is below `threshold`
 * (0..1) and remap the index map so it stays valid. Empty output means every
 * color is unused or the map was empty — the caller keeps the original
 * palette in that case.
 */
export function dropSparseColors(
  indexMap: Uint8Array,
  palette: RGB[],
  threshold: number,
): { indexMap: Uint8Array; palette: RGB[]; dropped: number; reassignments: Map<number, number> } | null {
  const total = indexMap.length
  if (total === 0 || palette.length === 0) return null

  const counts = new Array(palette.length).fill(0)
  for (let i = 0; i < total; i++) counts[indexMap[i]]++

  const keep = counts.map((c) => c / total >= threshold)
  const keptCount = keep.filter(Boolean).length
  if (keptCount === 0 || keptCount === palette.length) return null

  const remap = new Uint8Array(palette.length)
  let next = 0
  for (let i = 0; i < palette.length; i++) {
    if (keep[i]) remap[i] = next++
  }

  const out = new Uint8Array(total)
  for (let i = 0; i < total; i++) out[i] = remap[indexMap[i]]

  return {
    indexMap: out,
    palette: palette.filter((_, i) => keep[i]).map((c) => ({ ...c })),
    dropped: palette.length - keptCount,
    reassignments: dropTargets(palette, keep),
  }
}

/**
 * Where each dropped color's pixels go: its nearest SURVIVING color by
 * redmean distance — the same metric the re-quantization effectively
 * applies to those pixels. Keys are dropped indexes, values kept indexes.
 */
export function dropTargets(palette: RGB[], keep: boolean[]): Map<number, number> {
  const targets = new Map<number, number>()
  for (let i = 0; i < palette.length; i++) {
    if (keep[i]) continue
    let best = -1
    let bestDist = Infinity
    for (let j = 0; j < palette.length; j++) {
      if (!keep[j]) continue
      const dr = palette[j].r - palette[i].r
      const dg = palette[j].g - palette[i].g
      const db = palette[j].b - palette[i].b
      const avg = (palette[i].r + palette[j].r) / 2
      const d =
        (2 + avg / 256) * dr * dr + 4 * dg * dg + (2 + (255 - avg) / 256) * db * db
      if (d < bestDist) {
        bestDist = d
        best = j
      }
    }
    if (best >= 0) targets.set(i, best)
  }
  return targets
}
