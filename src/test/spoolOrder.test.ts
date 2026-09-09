import { describe, expect, it } from 'vitest'
import { orderSpools } from '../lib/spoolOrder'

describe('orderSpools', () => {
  it('sorts darkest → lightest', () => {
    const res = orderSpools([
      { id: 'white', rgb: { r: 245, g: 245, b: 245 } },
      { id: 'black', rgb: { r: 25, g: 25, b: 25 } },
      { id: 'red', rgb: { r: 200, g: 30, b: 30 } },
    ])
    expect(res.ids).toEqual(['black', 'red', 'white'])
  })

  it('keeps ids parallel to colors', () => {
    const res = orderSpools([
      { id: 'a', rgb: { r: 10, g: 10, b: 10 } },
      { id: 'b', rgb: { r: 200, g: 200, b: 200 } },
    ])
    expect(res.colors[0]).toEqual({ r: 10, g: 10, b: 10 })
    expect(res.ids[0]).toBe('a')
  })

  it('does not mutate the input', () => {
    const picks = [
      { id: 'light', rgb: { r: 240, g: 240, b: 240 } },
      { id: 'dark', rgb: { r: 20, g: 20, b: 20 } },
    ]
    orderSpools(picks)
    expect(picks[0].id).toBe('light')
  })

  it('handles an empty pick list', () => {
    expect(orderSpools([]).ids).toEqual([])
  })
})
