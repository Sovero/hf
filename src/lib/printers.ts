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

export const PRINTERS: PrinterInfo[] = [
  { id: 'bambu-a1-mini', name: 'Bambu Lab A1 mini', bedX: 180, bedY: 180 },
  { id: 'bambu-a1', name: 'Bambu Lab A1', bedX: 256, bedY: 256 },
  { id: 'bambu-p1s', name: 'Bambu Lab P1S', bedX: 256, bedY: 256 },
  { id: 'bambu-x1c', name: 'Bambu Lab X1 Carbon', bedX: 256, bedY: 256 },
  { id: 'prusa-mk4', name: 'Prusa MK4/S', bedX: 250, bedY: 210 },
  { id: 'prusa-mini', name: 'Prusa MINI+', bedX: 180, bedY: 180 },
  { id: 'prusa-coreone', name: 'Prusa CORE One', bedX: 250, bedY: 220 },
  { id: 'ender3', name: 'Creality Ender 3 / V2 / S1', bedX: 220, bedY: 220 },
  { id: 'ender5', name: 'Creality Ender 5', bedX: 220, bedY: 220 },
  { id: 'k1', name: 'Creality K1 / K1C', bedX: 220, bedY: 220 },
  { id: 'anycubic-kobra2', name: 'Anycubic Kobra 2', bedX: 220, bedY: 220 },
  { id: 'sovol-sv06', name: 'Sovol SV06', bedX: 220, bedY: 220 },
  { id: 'flashforge-ad5m', name: 'FlashForge Adventurer 5M', bedX: 220, bedY: 220 },
  { id: 'qidi-plus4', name: 'Qidi Plus4', bedX: 305, bedY: 305 },
  { id: 'ultimaker-s3', name: 'Ultimaker S3', bedX: 230, bedY: 230 },
]

/** Fallback printer when none is selected ("No printer bed"). */
export const PRINTER_NONE = 'none'

/** Look up a printer by id. */
export function findPrinter(id: string): PrinterInfo | undefined {
  return PRINTERS.find((p) => p.id === id)
}

/**
 * Bed dimensions for a selection: the printer's size, or null when "none"
 * is chosen (no plane shown).
 */
export function bedSizeFor(id: string): { x: number; y: number } | null {
  const p = findPrinter(id)
  return p ? { x: p.bedX, y: p.bedY } : null
}
