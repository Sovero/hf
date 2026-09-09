import { describe, expect, it } from 'vitest'
import { autoPickFilaments, redmeanDistance } from '../lib/autoPick'
import { allFilaments, findFilament } from '../lib/filamentLibrary'

describe('redmeanDistance', () => {
  it('is zero for identical colors', () => {
    expect(redmeanDistance({ r: 120, g: 40, b: 200 }, { r: 120, g: 40, b: 200 })).toBe(0)
  })

  it('weights green errors most (the eye is most sensitive there)', () => {
    const base = { r: 100, g: 100, b: 100 }
    const dR = redmeanDistance(base, { r: 130, g: 100, b: 100 })
    const dG = redmeanDistance(base, { r: 100, g: 130, b: 100 })
    const dB = redmeanDistance(base, { r: 100, g: 100, b: 130 })
    expect(dG).toBeGreaterThan(dR)
    expect(dG).toBeGreaterThan(dB)
  })

  it('penalizes red errors more on warm colors than on cool ones', () => {
    const cool = { r: 40, g: 40, b: 160 }
    const warm = { r: 160, g: 40, b: 40 }
    const dCool = redmeanDistance(cool, { r: 70, g: 40, b: 160 })
    const dWarm = redmeanDistance(warm, { r: 190, g: 40, b: 40 })
    expect(dWarm).toBeGreaterThan(dCool)
  })
})

describe('autoPickFilaments', () => {
  it('suggests a distinct filament per slot', () => {
    const palette = [
      { r: 25, g: 25, b: 25 },
      { r: 200, g: 30, b: 30 },
      { r: 240, g: 200, b: 30 },
      { r: 245, g: 245, b: 245 },
    ]
    const res = autoPickFilaments(palette)
    const ids = res.ids.filter((id): id is string => id !== null)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(palette.length)
  })

  it('matches near-exact palette colors to the closest spool', () => {
    const lib = allFilaments()
    const black = lib.find((f) => f.color.hex === '#1c1c1e') ?? lib[0]
    const res = autoPickFilaments([{ ...black.color.rgb }])
    expect(res.ids[0]).toBe(black.color.id)
    expect(res.distances[0]).toBeLessThan(30)
  })

  it('resolves a saved id list back to the same choices', () => {
    const palette = [
      { r: 240, g: 240, b: 240 },
      { r: 30, g: 30, b: 30 },
    ]
    const res = autoPickFilaments(palette)
    for (const id of res.ids) {
      if (id) expect(findFilament(id)).toBeDefined()
    }
  })

  it('keeps suggestions deterministic', () => {
    const palette = [{ r: 10, g: 180, b: 90 }, { r: 180, g: 60, b: 20 }]
    const a = autoPickFilaments(palette)
    const b = autoPickFilaments(palette)
    expect(a.ids).toEqual(b.ids)
    expect(a.distances).toEqual(b.distances)
  })

  it('an empty palette yields an empty result', () => {
    expect(autoPickFilaments([]).ids).toEqual([])
  })

  it('black and white map to dark and light filaments respectively', () => {
    const res = autoPickFilaments([{ r: 10, g: 10, b: 10 }, { r: 250, g: 250, b: 250 }])
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16)
      return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
    }
    const first = allFilaments().find((f) => f.color.id === res.ids[0])!
    const second = allFilaments().find((f) => f.color.id === res.ids[1])!
    expect(lum(first.color.hex)).toBeLessThan(lum(second.color.hex))
  })
})
