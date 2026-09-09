import { describe, expect, it } from 'vitest'
import { PRINTERS, PRINTER_NONE, bedSizeFor, findPrinter } from '../lib/printers'

describe('printer catalog', () => {
  it('has unique ids and positive bed sizes', () => {
    const ids = PRINTERS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PRINTERS) {
      expect(p.bedX).toBeGreaterThan(50)
      expect(p.bedY).toBeGreaterThan(50)
      expect(p.name.length).toBeGreaterThan(0)
    }
  })

  it('round-trips findPrinter and bedSizeFor', () => {
    for (const p of PRINTERS) {
      expect(findPrinter(p.id)?.bedX).toBe(p.bedX)
      expect(bedSizeFor(p.id)).toEqual({ x: p.bedX, y: p.bedY })
    }
  })

  it('falls back to null for unknown or "none" selection', () => {
    expect(bedSizeFor(PRINTER_NONE)).toBeNull()
    expect(bedSizeFor('no-such-printer')).toBeNull()
    expect(findPrinter('no-such-printer')).toBeUndefined()
  })

  it('includes the Qidi Q2 with its 270×270 mm bed', () => {
    const q2 = findPrinter('qidi-q2')
    expect(q2).toBeDefined()
    expect(q2!.bedX).toBe(270)
    expect(q2!.bedY).toBe(270)
    expect(q2!.name).toContain('Q2')
  })
})
