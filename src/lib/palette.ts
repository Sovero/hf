import type { RGB } from './types'
import { t, type Lang } from '../i18n'

/** Rec.709 luma, used to order colors dark → light. */
export function luminance(c: RGB): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

/** Sort a palette copy darkest → lightest by Rec.709 luminance. */
export function sortByLuminance(palette: RGB[]): RGB[] {
  return [...palette].sort((a, b) => luminance(a) - luminance(b))
}

export function rgbToHex(c: RGB): string {
  const hex = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`Invalid hex color: ${hex}`)
  const v = parseInt(m[1], 16)
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff }
}

/** Common filament colors with stable keys; display names live in i18n. */
export interface Filament {
  /** i18n key suffix, e.g. 'white' → 'filam.white'. */
  key: string
  color: RGB
}

export const COMMON_FILAMENTS: Filament[] = [
  { key: 'white', color: { r: 245, g: 245, b: 245 } },
  { key: 'bone', color: { r: 235, g: 228, b: 205 } },
  { key: 'lightgray', color: { r: 200, g: 200, b: 200 } },
  { key: 'silver', color: { r: 155, g: 155, b: 158 } },
  { key: 'darkgray', color: { r: 95, g: 95, b: 95 } },
  { key: 'black', color: { r: 25, g: 25, b: 25 } },
  { key: 'red', color: { r: 200, g: 30, b: 30 } },
  { key: 'darkred', color: { r: 130, g: 20, b: 20 } },
  { key: 'orange', color: { r: 235, g: 120, b: 25 } },
  { key: 'yellow', color: { r: 240, g: 200, b: 30 } },
  { key: 'gold', color: { r: 200, g: 160, b: 40 } },
  { key: 'green', color: { r: 40, g: 150, b: 60 } },
  { key: 'darkgreen', color: { r: 30, g: 95, b: 45 } },
  { key: 'lightblue', color: { r: 110, g: 180, b: 220 } },
  { key: 'blue', color: { r: 40, g: 90, b: 200 } },
  { key: 'darkblue', color: { r: 20, g: 45, b: 120 } },
  { key: 'purple', color: { r: 120, g: 50, b: 180 } },
  { key: 'pink', color: { r: 220, g: 60, b: 140 } },
  { key: 'brown', color: { r: 120, g: 75, b: 40 } },
  { key: 'tan', color: { r: 220, g: 175, b: 130 } },
]

/**
 * Closest common filament for a color (redmean distance), with the display
 * name in the requested language.
 */
export function nearestFilament(c: RGB, lang: Lang = 'en'): string {
  let best = COMMON_FILAMENTS[0]
  let bestDist = Infinity
  for (const f of COMMON_FILAMENTS) {
    const dr = f.color.r - c.r
    const dg = f.color.g - c.g
    const db = f.color.b - c.b
    const d = dr * dr + dg * dg + db * db
    if (d < bestDist) {
      bestDist = d
      best = f
    }
  }
  return t(lang, `filam.${best.key}`)
}