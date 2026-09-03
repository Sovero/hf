import type { RGB } from './types'

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

/** Common filament colors with names, for display in the legend. */
export const COMMON_FILAMENTS: { name: string; color: RGB }[] = [
  { name: 'White', color: { r: 245, g: 245, b: 245 } },
  { name: 'Off-white / Bone', color: { r: 235, g: 228, b: 205 } },
  { name: 'Light gray', color: { r: 200, g: 200, b: 200 } },
  { name: 'Silver / Gray', color: { r: 155, g: 155, b: 158 } },
  { name: 'Dark gray', color: { r: 95, g: 95, b: 95 } },
  { name: 'Black', color: { r: 25, g: 25, b: 25 } },
  { name: 'Red', color: { r: 200, g: 30, b: 30 } },
  { name: 'Dark red', color: { r: 130, g: 20, b: 20 } },
  { name: 'Orange', color: { r: 235, g: 120, b: 25 } },
  { name: 'Yellow', color: { r: 240, g: 200, b: 30 } },
  { name: 'Gold', color: { r: 200, g: 160, b: 40 } },
  { name: 'Green', color: { r: 40, g: 150, b: 60 } },
  { name: 'Dark green', color: { r: 30, g: 95, b: 45 } },
  { name: 'Light blue', color: { r: 110, g: 180, b: 220 } },
  { name: 'Blue', color: { r: 40, g: 90, b: 200 } },
  { name: 'Dark blue', color: { r: 20, g: 45, b: 120 } },
  { name: 'Purple', color: { r: 120, g: 50, b: 180 } },
  { name: 'Pink / Magenta', color: { r: 220, g: 60, b: 140 } },
  { name: 'Brown', color: { r: 120, g: 75, b: 40 } },
  { name: 'Tan / Skin', color: { r: 220, g: 175, b: 130 } },
]

/** Closest common filament name for a color, by redmean distance. */
export function nearestFilament(c: RGB): string {
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
  return best.name
}