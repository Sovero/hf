import { describe, expect, it, beforeEach } from 'vitest'
import { recordRecentSpools, recentSpoolIds, clearRecentSpools } from '../lib/recentSpools'

describe('recent spools', () => {
  beforeEach(() => clearRecentSpools())

  it('starts empty', () => {
    expect(recentSpoolIds()).toEqual([])
  })

  it('prepends newly used spools, newest first', () => {
    recordRecentSpools(['u3print:pla:white'])
    recordRecentSpools(['nit:pla:black', 'u3print:pla:white'])
    expect(recentSpoolIds()).toEqual(['nit:pla:black', 'u3print:pla:white'])
  })

  it('dedupes within one call and keeps order', () => {
    recordRecentSpools(['rec:petg:red', 'rec:petg:red', 'u3print:pla:black'])
    expect(recentSpoolIds()).toEqual(['rec:petg:red', 'u3print:pla:black'])
  })

  it('caps the list so the row stays one line', () => {
    // Real ids: cycle brand/color pairs so every id resolves.
    const brands = ['u3print', 'filamentarno', 'rec', 'lider3d']
    const colors = ['white', 'black', 'red', 'blue', 'yellow', 'green', 'orange', 'gray', 'lightgray', 'darkgray', 'natural', 'skyblue', 'pink', 'purple', 'brown', 'salad']
    const many = Array.from({ length: 30 }, (_, i) => `${brands[i % brands.length]}:pla:${colors[i % colors.length]}`)
    recordRecentSpools(many)
    expect(recentSpoolIds().length).toBeLessThanOrEqual(12)
    expect(recentSpoolIds()[0]).toBe(many[0])
  })

  it('drops ids that no longer resolve to a real filament', () => {
    recordRecentSpools(['brand:pla:gone', 'nit:pla:beige'])
    expect(recentSpoolIds()).toEqual(['nit:pla:beige'])
  })
})
