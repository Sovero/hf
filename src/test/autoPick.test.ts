import { describe, expect, it } from 'vitest'
import { autoPickFilaments, minCostAssignment, redmeanDistance, PICK_MIN_DELTA_E } from '../lib/autoPick'
import { allFilaments, findFilament, type LibraryChoice } from '../lib/filamentLibrary'
import { deltaE2000Rgb } from '../lib/deltae'
import type { RGB } from '../lib/types'

const px = (hex: string): RGB => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
})

const dE = (a: RGB, b: RGB) => deltaE2000Rgb(a.r, a.g, a.b, b.r, b.g, b.b)

/** Synthetic catalog entry, so tests do not depend on the brand library. */
const spool = (id: string, hex: string, materialId: 'pla' | 'petg' = 'pla'): LibraryChoice => ({
  brandId: 'test',
  brandName: 'Test',
  materialId,
  color: { id, nameRu: id, nameEn: id, hex, rgb: px(hex) },
})

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

describe('minCostAssignment', () => {
  /** Deterministic LCG so the fixture is random-looking but reproducible. */
  const lcg = (seed: number) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

  const bruteForce = (cost: number[][]): number => {
    const n = cost.length
    const m = cost[0].length
    const used = new Array(m).fill(false)
    const rec = (i: number): number => {
      if (i === n) return 0
      let best = Infinity
      for (let j = 0; j < m; j++) {
        if (used[j]) continue
        used[j] = true
        best = Math.min(best, cost[i][j] + rec(i + 1))
        used[j] = false
      }
      return best
    }
    return rec(0)
  }

  it('matches brute force on random rectangular matrices', () => {
    const rand = lcg(7)
    for (let trial = 0; trial < 40; trial++) {
      const n = 1 + Math.floor(rand() * 4)
      const m = n + Math.floor(rand() * 3)
      const cost = Array.from({ length: n }, () => Array.from({ length: m }, () => Math.round(rand() * 900)))
      const pick = minCostAssignment(cost)
      expect(new Set(pick).size).toBe(n)
      const total = pick.reduce((s, j, i) => s + cost[i][j], 0)
      expect(total).toBeCloseTo(bruteForce(cost), 6)
    }
  })

  it('gives every row its own column and no column twice', () => {
    expect(minCostAssignment([[5, 1, 9], [8, 4, 2]])).toEqual([1, 2])
  })

  it('beats the greedy pair-by-pair choice', () => {
    // Sorting all pairs by cost and taking the first free ones (the old
    // auto-pick) grabs cost 1, leaves row 0 with 2 and row 1 with 100.
    const cost = [
      [1, 2],
      [1.5, 100],
    ]
    const pairs = cost
      .flatMap((row, i) => row.map((d, j) => ({ i, j, d })))
      .sort((a, b) => a.d - b.d)
    const rowTaken = new Array(cost.length).fill(false)
    const colTaken = new Array(cost[0].length).fill(false)
    let greedy = 0
    for (const p of pairs) {
      if (rowTaken[p.i] || colTaken[p.j]) continue
      rowTaken[p.i] = true
      colTaken[p.j] = true
      greedy += p.d
    }
    expect(greedy).toBe(101)
    const pick = minCostAssignment(cost)
    expect(pick).toEqual([1, 0])
    expect(pick.reduce((s, j, i) => s + cost[i][j], 0)).toBe(3.5)
  })
})

describe('autoPickFilaments', () => {
  it('suggests a distinct filament per slot', () => {
    const palette = [px('#191919'), px('#c81e1e'), px('#f0c81e'), px('#f5f5f5')]
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
    const palette = [px('#f0f0f0'), px('#1e1e1e')]
    const res = autoPickFilaments(palette)
    for (const id of res.ids) {
      if (id) expect(findFilament(id)).toBeDefined()
    }
  })

  it('keeps suggestions deterministic', () => {
    const palette = [px('#0ab45a'), px('#b43c14')]
    const opts = { weights: [0.4, 0.1], preferredIds: ['u3print:pla:black'] }
    const a = autoPickFilaments(palette, opts)
    const b = autoPickFilaments(palette, opts)
    expect(a.ids).toEqual(b.ids)
    expect(a.distances).toEqual(b.distances)
  })

  it('an empty palette yields an empty result', () => {
    expect(autoPickFilaments([]).ids).toEqual([])
  })

  it('black and white map to dark and light filaments respectively', () => {
    const res = autoPickFilaments([px('#0a0a0a'), px('#fafafa')])
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16)
      return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
    }
    const first = allFilaments().find((f) => f.color.id === res.ids[0])!
    const second = allFilaments().find((f) => f.color.id === res.ids[1])!
    expect(lum(first.color.hex)).toBeLessThan(lum(second.color.hex))
  })
})

describe('autoPickFilaments — distinct spool colors', () => {
  it('never spends two slots on one color when the catalog has an alternative', () => {
    // The palette the app produces for a sunset photo in "by image colors":
    // measured as picking #c9862f twice, i.e. 5 printable tones instead of 6.
    const palette = ['#433129', '#4c4243', '#dc3318', '#71655d', '#c48049', '#df8a1d'].map(px)
    const res = autoPickFilaments(palette)
    const hexes = res.choices.map((c) => c!.color.hex.toLowerCase())
    expect(new Set(hexes).size).toBe(palette.length)
    expect(res.distinctColors).toBe(palette.length)
    for (let i = 0; i < hexes.length; i++) {
      for (let j = i + 1; j < hexes.length; j++) {
        expect(dE(px(hexes[i]), px(hexes[j]))).toBeGreaterThanOrEqual(PICK_MIN_DELTA_E - 1e-9)
      }
    }
  })

  it('keeps HueForge-style band palettes distinct too', () => {
    const palette = ['#312b2d', '#792f2c', '#9f382a', '#a05133', '#bd6435', '#d1943b'].map(px)
    const res = autoPickFilaments(palette)
    expect(new Set(res.choices.map((c) => c!.color.hex.toLowerCase())).size).toBe(palette.length)
  })

  it('treats near-identical catalog colors as one spool', () => {
    const library = [spool('red', '#d93a1f'), spool('near-red', '#dc3318'), spool('blue', '#1e4fae')]
    expect(dE(px('#d93a1f'), px('#dc3318'))).toBeLessThan(PICK_MIN_DELTA_E)
    // Both slots want the red tone, but it stacks as one color: exactly one of
    // them gets it and the other is pushed to the only remaining color.
    const res = autoPickFilaments([px('#d93a1f'), px('#db3419')], { library })
    expect(res.distinctColors).toBe(2)
    expect(res.ids.filter((id) => id === 'blue')).toHaveLength(1)
    expect(res.choices.filter((c) => c!.color.hex.toLowerCase() !== '#1e4fae')).toHaveLength(1)
  })

  it('repeats a color only when the catalog cannot fill the palette', () => {
    const res = autoPickFilaments([px('#d93a1f'), px('#1e4fae')], { library: [spool('red', '#d93a1f')] })
    expect(res.ids).toEqual(['red', 'red'])
    expect(res.distinctColors).toBe(1)
  })

  it('returns empty matches for an empty catalog', () => {
    const res = autoPickFilaments([px('#d93a1f')], { library: [] })
    expect(res.ids).toEqual([null])
    expect(res.distances).toEqual([Infinity])
  })
})

describe('autoPickFilaments — weights drive the contested spool', () => {
  const library = [spool('red', '#d93a1f'), spool('grey', '#8a8d90')]
  // Slot 1 is a hair closer to red; slot 0 is the desaturated red that would
  // otherwise be pushed off to grey.
  const palette = [px('#c9502a'), px('#d93a1f')]

  it('preconditions hold (the choice is genuinely contested)', () => {
    const [a, b] = palette
    expect(dE(b, px('#d93a1f'))).toBeLessThan(dE(a, px('#d93a1f')))
    expect(dE(a, px('#8a8d90'))).toBeLessThan(dE(b, px('#8a8d90')))
  })

  it('without weights the closer slot wins the contested color', () => {
    const res = autoPickFilaments(palette, { library })
    expect(res.ids[1]).toBe('red')
  })

  it('with weights the color that covers more of the print wins it', () => {
    const res = autoPickFilaments(palette, { library, weights: [0.4, 0.05] })
    expect(res.ids[0]).toBe('red')
  })

  it('a sliver keeps a floor of importance, so it is never thrown away', () => {
    const res = autoPickFilaments(palette, { library, weights: [0.9, 1e-6] })
    // Even at a millionth of the area the slot is still assigned its own color.
    expect(res.ids[0]).toBe('red')
    expect(res.ids[1]).toBe('grey')
  })

  it('falls back to equal weights on a mismatched list', () => {
    const even = autoPickFilaments(palette, { library })
    const broken = autoPickFilaments(palette, { library, weights: [1] })
    expect(broken.ids).toEqual(even.ids)
  })
})

describe('autoPickFilaments — the user’s own spools', () => {
  it('prefers a filament the user owns between equal catalog colors', () => {
    const library = [
      spool('u3print:pla:red', '#d93a1f'),
      spool('filamentarno:petg:red', '#d93a1f', 'petg'),
    ]
    const res = autoPickFilaments([px('#d93a1f')], { library, preferredIds: ['filamentarno:petg:red'] })
    expect(res.ids[0]).toBe('filamentarno:petg:red')
  })

  it('ranks the earlier preferred id higher', () => {
    const library = [spool('a', '#d93a1f'), spool('b', '#d93a1f'), spool('c', '#d93a1f')]
    const res = autoPickFilaments([px('#d93a1f')], { library, preferredIds: ['c', 'b'] })
    expect(res.ids[0]).toBe('c')
  })

  it('falls back to catalog order when nothing is preferred', () => {
    const library = [spool('first', '#d93a1f'), spool('second', '#d93a1f')]
    expect(autoPickFilaments([px('#d93a1f')], { library }).ids[0]).toBe('first')
  })
})
