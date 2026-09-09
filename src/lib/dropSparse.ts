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
): { indexMap: Uint8Array; palette: RGB[]; dropped: number } | null {
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
  }
}
