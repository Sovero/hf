import type { RGB } from './types'

export interface ColorShare {
  /** Palette index. */
  index: number
  /** Share of pixels in 0..1. */
  share: number
  /** Share formatted as percent, 1 decimal. */
  percent: number
}

/**
 * Percent of the image area painted by each palette color, straight from
 * the quantized index map (post-dither, post-cleanup — exactly what will
 * be printed). Index 0 is the darkest palette entry.
 */
export function colorShares(indexMap: Uint8Array, paletteSize: number): ColorShare[] {
  const counts = new Array(paletteSize).fill(0)
  for (let i = 0; i < indexMap.length; i++) counts[indexMap[i]]++
  const total = indexMap.length || 1
  return counts.map((c, index) => {
    const share = c / total
    return { index, share, percent: Math.round(share * 1000) / 10 }
  })
}

/** Format a share as "12.3%"; used by the palette legend rows. */
export function formatShare(percent: number): string {
  return `${percent.toFixed(1)}%`
}

/** Palette color type guard for consumers that need the RGB. */
export function colorForIndex(palette: RGB[], index: number): RGB {
  return palette[index]
}
