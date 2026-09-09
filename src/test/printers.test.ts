import { describe, expect, it } from 'vitest'
import { PRINTERS, PRINTER_NONE, findPrinter, bedSizeFor } from '../lib/printers'

describe('printer catalog', () => {
  it('has unique ids and positive bed sizes', () => {
    const ids = PRINTERS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PRINTERS) {
      expect(p.bedX).toBeGreaterThanOrEqual(120)
      expect(p.bedY).toBeGreaterThanOrEqual(120)
      expect(p.name.length).toBeGreaterThan(0)
    }
  })

  it('round-trips findPrinter on every id', () => {
    for (const p of PRINTERS) {
      expect(findPrinter(p.id)?.name).toBe(p.name)
    }
    expect(findPrinter('nope')).toBeUndefined()
  })

  it('bedSizeFor returns the printer bed or null for none', () => {
    expect(bedSizeFor('prusa-mk4')).toEqual({ x: 250, y: 210 })
    expect(bedSizeFor('bambu-x1c')).toEqual({ x: 256, y: 256 })
    expect(bedSizeFor(PRINTER_NONE)).toBeNull()
    expect(bedSizeFor('gone')).toBeNull()
  })
})
