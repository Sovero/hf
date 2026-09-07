import { describe, expect, it, beforeEach } from 'vitest'
import {
  BRANDS, LIBRARY, allFilaments, findFilament, nearestLibraryFilament, materialName,
  addCustomFilament, removeCustomFilament, customFilaments, isCustomId, CUSTOM_BRAND_ID,
} from '../lib/filamentLibrary'
import { hexToRgb } from '../lib/palette'

describe('filament library', () => {
  it('carries the top-8 Russian brands from the 3dtoday survey, in rank order', () => {
    expect(BRANDS.map((b) => b.id)).toEqual([
      'u3print', 'filamentarno', 'rec', 'lider3d', 'bestfilament', '3dclub', 'printproduct', 'cyberfiber',
    ])
    for (const b of BRANDS) expect(b.site).toMatch(/^https:\//)
  })

  it('exposes PLA/PETG/ABS colors for every brand', () => {
    for (const brand of BRANDS) {
      for (const material of ['pla', 'petg', 'abs'] as const) {
        const m = LIBRARY[brand.id][material]
        expect(m.colors.length).toBeGreaterThanOrEqual(16)
        for (const c of m.colors) {
          expect(c.id).toBe(`${brand.id}:${material}:${c.id.split(':')[2]}`)
          expect(c.hex).toMatch(/^#[0-9a-f]{6}$/i)
          expect(c.rgb).toEqual(hexToRgb(c.hex))
        }
      }
    }
  })

  it('round-trips findFilament on every composite id', () => {
    for (const f of allFilaments()) {
      const found = findFilament(f.color.id)
      expect(found?.brandName).toBe(f.brandName)
      expect(found?.color.hex).toBe(f.color.hex)
    }
    expect(findFilament('nope:pla:white')).toBeUndefined()
  })

  it('maps exact catalog colors through nearestLibraryFilament (zero distance)', () => {
    const white = findFilament('bestfilament:pla:white')!
    const hit = nearestLibraryFilament(white.color.rgb)
    // Several brands share the exact same catalog hex; the nearest match is
    // one of them (first in rank order wins ties).
    expect(hit.color.hex).toBe(white.color.hex)
    expect(hit.color.rgb).toEqual(white.color.rgb)
  })

  it('never suggests a filament already assigned to another band', () => {
    const black = findFilament('bestfilament:pla:black')!
    const suggestion = nearestLibraryFilament(black.color.rgb, ['bestfilament:pla:black'])
    expect(suggestion.color.id).not.toBe('bestfilament:pla:black')
  })

  it('names materials in a stable uppercase form', () => {
    expect(materialName('pla')).toBe('PLA')
    expect(materialName('petg')).toBe('PETG')
    expect(materialName('abs')).toBe('ABS')
  })
})

describe('custom filaments', () => {
  beforeEach(() => {
    // Tests run in node (no localStorage) — the in-memory cache still works,
    // so clear it by removing everything added in a previous test.
    for (const f of customFilaments()) removeCustomFilament(f.id)
  })

  it('adds a custom filament with a stable composite id', () => {
    const added = addCustomFilament({ name: 'Мой красный', hex: '#cc2222', materialId: 'pla' })
    expect(added.id).toMatch(/^my:pla:/)
    expect(added.rgb).toEqual(hexToRgb('#cc2222'))
    expect(customFilaments()).toHaveLength(1)
  })

  it('merges customs into allFilaments and findFilament under the My brand', () => {
    const added = addCustomFilament({ name: 'My teal', hex: '#20b2aa', materialId: 'petg' })
    const choice = findFilament(added.id)
    expect(choice).toBeTruthy()
    expect(choice!.brandId).toBe(CUSTOM_BRAND_ID)
    expect(choice!.brandName).toBe('My filaments')
    expect(choice!.materialId).toBe('petg')
    expect(allFilaments().some((f) => f.color.id === added.id)).toBe(true)
  })

  it('suggests customs when they are the nearest color', () => {
    const added = addCustomFilament({ name: 'Neon yellow', hex: '#ccff00', materialId: 'pla' })
    const probe = hexToRgb('#c8f90a')
    expect(nearestLibraryFilament(probe).color.id).toBe(added.id)
  })

  it('removes by id and reports whether anything was removed', () => {
    const a = addCustomFilament({ name: 'A', hex: '#111111', materialId: 'abs' })
    addCustomFilament({ name: 'B', hex: '#222222', materialId: 'abs' })
    expect(removeCustomFilament(a.id)).toBe(true)
    expect(removeCustomFilament(a.id)).toBe(false)
    expect(customFilaments()).toHaveLength(1)
    expect(findFilament(a.id)).toBeUndefined()
  })

  it('flags custom ids for the UI', () => {
    const added = addCustomFilament({ name: 'X', hex: '#334455', materialId: 'pla' })
    expect(isCustomId(added.id)).toBe(true)
    expect(isCustomId('bestfilament:pla:white')).toBe(false)
  })

  it('trims names and falls back when the name is empty', () => {
    const added = addCustomFilament({ name: '  ', hex: '#123456', materialId: 'pla' })
    expect(added.nameRu).toBe('Мой филамент')
    expect(added.nameEn).toBe('My filament')
  })
})
