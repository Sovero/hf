import { luminance } from './palette'
import type { RGB } from './types'

export interface OrderedSpools {
  /** Spool colors sorted darkest → lightest (the print order). */
  colors: RGB[]
  /** Parallel composite ids, following the same order. */
  ids: string[]
}

/**
 * Order the user's picked spools for printing: darkest first (printed at the
 * base), lightest last — the HueForge stack convention. Ids are kept in the
 * same order so the ★ assignments follow their colors.
 */
export function orderSpools(picks: { id: string; rgb: RGB }[]): OrderedSpools {
  const sorted = [...picks].sort((a, b) => luminance(a.rgb) - luminance(b.rgb))
  return {
    colors: sorted.map((p) => ({ ...p.rgb })),
    ids: sorted.map((p) => p.id),
  }
}
