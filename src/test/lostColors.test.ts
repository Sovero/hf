import { describe, expect, it } from 'vitest'
import { lostColors } from '../lib/lostColors'
import { mapToLuminanceBands } from '../lib/quantize'

/**
 * Four flat teal bands (dark → pale) with a red suit (≈ 6 %) at the very
 * brightness of the second band (luma ≈ 74): one brightness, two hues.
 */
function astronaut(): { rgba: Uint8ClampedArray; w: number; h: number } {
  const w = 120
  const h = 80
  const rgba = new Uint8ClampedArray(w * h * 4)
  const bands = [[10, 40, 45], [30, 85, 90], [80, 170, 150], [180, 230, 200]]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c = bands[Math.min(3, Math.floor((y / h) * 4))]!
      if ((x - 60) ** 2 + (y - 45) ** 2 < 15 ** 2) c = [200, 40, 45]
      rgba.set([c[0]!, c[1]!, c[2]!, 255], (y * w + x) * 4)
    }
  }
  return { rgba, w, h }
}

describe('lostColors', () => {
  it('reports the red suit the brightness palette cannot print', () => {
    const { rgba, w, h } = astronaut()
    const q = mapToLuminanceBands(rgba, 4, w, h, false, 0)
    const lost = lostColors(rgba, q.palette)
    expect(lost.length).toBeGreaterThan(0)
    expect(lost[0]!.color.r).toBeGreaterThan(150)
    expect(lost[0]!.color.g).toBeLessThan(90)
    expect(lost[0]!.share).toBeGreaterThan(0.03)
  })

  it('stays quiet when the palette covers the picture', () => {
    const { rgba } = astronaut()
    const palette = [
      { r: 20, g: 60, b: 70 },
      { r: 70, g: 140, b: 120 },
      { r: 120, g: 220, b: 170 },
      { r: 200, g: 40, b: 45 },
    ]
    expect(lostColors(rgba, palette)).toEqual([])
  })
})
