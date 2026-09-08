import { describe, it, expect } from 'vitest'
import { deltaE2000, srgbToLab, deltaE2000Rgb } from '../lib/deltae'

/**
 * Reference vectors from Sharma, Wu & Dalal (2005), Table 1 — the pairs are
 * (L1,a1,b1, L2,a2,b2, expected ΔE00).
 */
const SHARMA: [number, number, number, number, number, number, number][] = [
  [50.0, 2.6772, -79.7751, 50.0, 0.0, -82.7485, 2.0425],
  [50.0, 3.1571, -77.2803, 50.0, 0.0, -82.7485, 2.8615],
  [50.0, 2.8361, -74.02, 50.0, 0.0, -82.7485, 3.4412],
  [50.0, -1.3802, -84.2814, 50.0, 0.0, -82.7485, 1.0],
  [50.0, 0.0, 0.0, 50.0, -1.0, 2.0, 2.3669],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0009, 7.1792],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0011, 7.2195],
  [50.0, -0.001, 2.49, 50.0, 0.0009, -2.49, 4.8045],
  [50.0, -0.001, 2.49, 50.0, 0.0011, -2.49, 4.7461],
  [50.0, 2.5, 0.0, 73.0, 25.0, -18.0, 27.1492],
  [50.0, 2.5, 0.0, 61.0, -5.0, 29.0, 22.8977],
  [50.0, 2.5, 0.0, 56.0, -27.0, -3.0, 31.903],
  [50.0, 2.5, 0.0, 58.0, 24.0, 15.0, 19.4535],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
  [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
  [61.2901, 3.7196, -5.3901, 61.4292, 2.248, -4.962, 1.8731],
  [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
  [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
  [36.4612, 47.858, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
  [90.8027, -2.0831, 1.441, 91.1528, -1.6435, 0.0447, 1.4441],
  [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
  [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
  [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
]

describe('CIEDE2000', () => {
  it('matches the Sharma reference vectors within 1e-3', () => {
    for (const [l1, a1, b1, l2, a2, b2, expected] of SHARMA) {
      const got = deltaE2000(l1, a1, b1, l2, a2, b2)
      expect(got, `ΔE(${l1},${a1},${b1}) vs (${l2},${a2},${b2})`).toBeCloseTo(expected, 3)
    }
  })

  it('is symmetric', () => {
    const [l1, a1, b1, l2, a2, b2] = [50.0, 2.49, -0.001, 50.0, -2.49, 0.0011]
    expect(deltaE2000(l1, a1, b1, l2, a2, b2)).toBeCloseTo(deltaE2000(l2, a2, b2, l1, a1, b1), 10)
  })

  it('is zero for identical colors', () => {
    expect(deltaE2000(41.3, 12.5, -8.9, 41.3, 12.5, -8.9)).toBe(0)
  })
})

describe('sRGB → Lab', () => {
  it('maps white to L≈100 and black to L≈0', () => {
    const [lw, aw, bw] = srgbToLab(255, 255, 255)
    expect(lw).toBeCloseTo(100, 5)
    expect(aw).toBeCloseTo(0, 4)
    expect(bw).toBeCloseTo(0, 4)
    const [lb] = srgbToLab(0, 0, 0)
    expect(lb).toBeCloseTo(0, 5)
  })

  it('maps pure red to the known Lab value', () => {
    const [l, a, b] = srgbToLab(255, 0, 0)
    expect(l).toBeCloseTo(53.24, 1)
    expect(a).toBeCloseTo(80.09, 1)
    expect(b).toBeCloseTo(67.2, 1)
  })
})

describe('ΔE2000Rgb', () => {
  it('reports ~0 for identical sRGB and a large gap for complementary colors', () => {
    expect(deltaE2000Rgb(10, 10, 10, 10, 10, 10)).toBeLessThan(1e-9)
    const d = deltaE2000Rgb(0, 0, 0, 255, 255, 255)
    expect(d).toBeGreaterThan(90)
  })
})