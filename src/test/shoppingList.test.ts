import { describe, expect, it } from 'vitest'
import { shoppingList, unassignedCount, formatShoppingList } from '../lib/shoppingList'
import { findFilament } from '../lib/filamentLibrary'

/** Two u3print spools + one shared by two bands + one unassigned slot. */
const ASSIGNMENTS = [
  'u3print:pla:black',
  'u3print:pla:black', // same spool reused by band 2
  'nit:pla:beige',
  null,
]

/** 100 px: bands 0/1 split 25/25, band 2 gets 30, band 3 gets 20. */
function indexMap(): Uint8Array {
  const m = new Uint8Array(100)
  for (let i = 0; i < 25; i++) m[i] = 0
  for (let i = 25; i < 50; i++) m[i] = 1
  for (let i = 50; i < 80; i++) m[i] = 2
  for (let i = 80; i < 100; i++) m[i] = 3
  return m
}

describe('shopping list', () => {
  it('dedupes two bands sharing one spool into one aggregated row', () => {
    const items = shoppingList(ASSIGNMENTS, indexMap(), 'en')
    expect(items).toHaveLength(2)
    const black = items.find((i) => i.id === 'u3print:pla:black')!
    expect(black.bands).toEqual([0, 1])
    expect(black.areaPercent).toBe(50)
  })

  it('carries brand, material, color name and hex per spool', () => {
    const items = shoppingList(ASSIGNMENTS, indexMap(), 'ru')
    const beige = items.find((i) => i.id === 'nit:pla:beige')!
    expect(beige.brandName).toBe('НИТ')
    expect(beige.material).toBe('PLA')
    expect(beige.colorName).toBe('Бежевый')
    expect(beige.hex).toBe('#e6d5b8')
    expect(beige.bands).toEqual([2])
    expect(beige.areaPercent).toBe(30)
  })

  it('localizes the color name per language', () => {
    const en = shoppingList(ASSIGNMENTS, null, 'en').find((i) => i.id === 'nit:pla:beige')!
    const ru = shoppingList(ASSIGNMENTS, null, 'ru').find((i) => i.id === 'nit:pla:beige')!
    expect(en.colorName).toBe('Beige')
    expect(ru.colorName).toBe('Бежевый')
  })

  it('skips unassigned slots and stale library ids', () => {
    const items = shoppingList(['gone:pla:white', null, 'u3print:pla:black'], null, 'en')
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('u3print:pla:black')
    expect(unassignedCount(['gone:pla:white', null, 'u3print:pla:black'])).toBe(1)
  })

  it('formats the text with numbered rows and the unassigned warning', () => {
    const items = shoppingList(ASSIGNMENTS, indexMap(), 'en')
    const text = formatShoppingList(items, { unassigned: 1, lang: 'en', header: 'HueForge — shopping list' })
    expect(text).toContain('1. U3Print · PLA · Black')
    expect(text).toContain('Used by bands: #1, #2')
    expect(text).toContain('Area: 50.0%')
    expect(text).toContain('⚠ 1 color(s) have no filament assigned')
    expect(text).toContain('2. НИТ · PLA · Beige')
  })

  it('formats the empty state in Russian', () => {
    const text = formatShoppingList([], { unassigned: 0, lang: 'ru', header: 'Список покупок' })
    expect(text).toContain('Филаменты не назначены')
  })

  it('resolves every seeded assignment through the real library', () => {
    for (const id of ASSIGNMENTS) {
      if (id && !id.startsWith('gone:')) expect(findFilament(id)).toBeTruthy()
    }
  })
})
