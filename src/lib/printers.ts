/**
 * Real 3D-printer bed sizes for the viewer's translucent bed plane —
 * pick your printer and see whether the print fits its table. Sizes are
 * the usable print volume in mm (single-piece, no multi-part expanders).
 */

export interface PrinterInfo {
  /** Stable id used in settings persistence and i18n. */
  id: string
  /** Display name (brand + model, not translated). */
  name: string
  /** Usable bed: width (X) × depth (Y) in mm. */
  bedX: number
  bedY: number
}

/**
 * One entry per distinct bed: the viewer only shows the table, so printers
 * that share a bed size would draw the same plane. The name lists the common
 * models with that bed, ordered by size.
 */
export const PRINTERS: PrinterInfo[] = [
  { id: 'bambu-a1-mini', name: 'Bambu Lab A1 mini / Prusa MINI+', bedX: 180, bedY: 180 },
  { id: 'ender3', name: 'Creality Ender 3 / K1, Anycubic Kobra 2', bedX: 220, bedY: 220 },
  { id: 'ultimaker-s3', name: 'Ultimaker S3', bedX: 230, bedY: 230 },
  { id: 'prusa-mk4', name: 'Prusa MK4/S', bedX: 250, bedY: 210 },
  { id: 'prusa-coreone', name: 'Prusa CORE One', bedX: 250, bedY: 220 },
  { id: 'bambu-a1', name: 'Bambu Lab A1 / P1S / X1C', bedX: 256, bedY: 256 },
  { id: 'qidi-q2', name: 'Qidi Q2', bedX: 270, bedY: 270 },
  { id: 'qidi-plus4', name: 'Qidi Plus4', bedX: 305, bedY: 305 },
]

/**
 * Ids of catalog entries merged into a same-bed entry, so a saved selection
 * keeps showing the same table.
 */
const MERGED_PRINTERS: Record<string, string> = {
  'prusa-mini': 'bambu-a1-mini',
  ender5: 'ender3',
  k1: 'ender3',
  'anycubic-kobra2': 'ender3',
  'sovol-sv06': 'ender3',
  'flashforge-ad5m': 'ender3',
  'bambu-p1s': 'bambu-a1',
  'bambu-x1c': 'bambu-a1',
}

/** Current catalog id for a (possibly merged) saved printer id. */
export function canonicalPrinterId(id: string): string {
  return MERGED_PRINTERS[id] ?? id
}

/** Fallback printer when none is selected ("No printer bed"). */
export const PRINTER_NONE = 'none'

/** Look up a printer by id. */
export function findPrinter(id: string): PrinterInfo | undefined {
  const canonical = canonicalPrinterId(id)
  return PRINTERS.find((p) => p.id === canonical)
}

/**
 * Bed dimensions for a selection: the printer's size, or null when "none"
 * is chosen (no plane shown).
 */
export function bedSizeFor(id: string): { x: number; y: number } | null {
  const p = findPrinter(id)
  return p ? { x: p.bedX, y: p.bedY } : null
}
