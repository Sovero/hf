import { describe, expect, it } from 'vitest'
import { buildCalibrationSwatch, CALIB_BASE_MM, CALIB_STEPS, fitTau, type CalibSample } from '../lib/calibration'
import { transmission, DEFAULT_TAU_MM } from '../lib/transmission'
import type { RGB } from '../lib/types'

const BLACK: RGB = { r: 10, g: 10, b: 10 }
const RED: RGB = { r: 200, g: 60, b: 50 }
const TAU = 0.9

/** Photo of a swatch step: transmission blend over the base, then an 0.8×
 * camera exposure scale applied to everything (as a real phone would). */
function photoSample(t: number): RGB {
  const T = transmission(t, TAU)
  const m: RGB = {
    r: BLACK.r + (RED.r - BLACK.r) * T,
    g: BLACK.g + (RED.g - BLACK.g) * T,
    b: BLACK.b + (RED.b - BLACK.b) * T,
  }
  return { r: m.r * 0.8, g: m.g * 0.8, b: m.b * 0.8 }
}

function samples(): CalibSample[] {
  return CALIB_STEPS.map((t) => ({ thicknessMm: t, rgb: photoSample(t) }))
}

describe('fitTau', () => {
  it('recovers the true τ from synthetic photo samples (exposure-normalized)', () => {
    const fitted = fitTau(samples(), photoSample(0), BLACK, RED)
    expect(fitted).toBeCloseTo(TAU, 3)
  })

  it('is robust to one stray click (median over steps × channels)', () => {
    const noisy: CalibSample[] = [...samples(), { thicknessMm: 0.4, rgb: { r: 255, g: 255, b: 255 } }]
    expect(fitTau(noisy, photoSample(0), BLACK, RED)).toBeCloseTo(TAU, 3)
  })

  it('falls back to the default τ when the color matches the base', () => {
    expect(fitTau(samples(), photoSample(0), BLACK, BLACK)).toBe(DEFAULT_TAU_MM)
  })
})

describe('buildCalibrationSwatch', () => {
  it('builds an STL spanning the documented layout with the stepped heights', () => {
    const sw = buildCalibrationSwatch(RED, '#000000', 0.2)
    const view = new DataView(sw.stl)
    const tris = view.getUint32(80, true)
    expect(tris).toBeGreaterThan(0)
    expect(sw.stl.byteLength).toBe(84 + 50 * tris)

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let t = 0; t < tris; t++) {
      const off = 84 + t * 50
      for (let v = 0; v < 3; v++) {
        const base = off + 12 + v * 12
        const x = view.getFloat32(base, true)
        const y = view.getFloat32(base + 4, true)
        const z = view.getFloat32(base + 8, true)
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
        minZ = Math.min(minZ, z)
        maxZ = Math.max(maxZ, z)
      }
    }
    expect(maxX).toBeCloseTo(60, 3) // SWATCH_W
    expect(maxY).toBeCloseTo(14, 3) // SWATCH_D
    expect(minX).toBeCloseTo(0, 3)
    expect(minY).toBeCloseTo(0, 3)
    expect(minZ).toBeCloseTo(0, 3) // closed bottom grid
    expect(maxZ).toBeCloseTo(CALIB_BASE_MM + CALIB_STEPS[CALIB_STEPS.length - 1], 3) // tallest step
  })

  it('documents the layout, swap layer and both languages', () => {
    const sw = buildCalibrationSwatch(RED, '#000000', 0.2)
    expect(sw.info).toContain('#c83c32')
    expect(sw.info).toContain('0.20 mm')
    // Base 1.0 mm at a 0.2 mm layer height → swap at the start of layer 5.
    expect(sw.info).toContain('layer 5')
    expect(sw.info).toContain('--- EN ---')
    expect(sw.info).toContain('--- RU ---')
  })
})
