import { describe, expect, it } from 'vitest'
import { FACE_DIRS, easeInOutCubic, sphericalFor, viewDirForZone, zoneForLocalPoint } from '../lib/viewCubeMath'

describe('zoneForLocalPoint', () => {
  it('classifies face centers as their face', () => {
    expect(zoneForLocalPoint(0, 0, 1, 0.5).faces).toEqual(['front'])
    expect(zoneForLocalPoint(0, 1, 0, 0.5).faces).toEqual(['top'])
    expect(zoneForLocalPoint(-1, 0, 0, 0.5).faces).toEqual(['left'])
    expect(zoneForLocalPoint(0, -1, 0, 0.5).faces).toEqual(['bottom'])
  })

  it('classifies border strips as edges from either adjacent face', () => {
    // The same edge point expressed from two adjacent faces must agree.
    expect(zoneForLocalPoint(0, 0.45, 0.5, 0.5).id).toBe('front+top')
    expect(zoneForLocalPoint(0, 0.5, 0.45, 0.5).id).toBe('front+top')
    expect(zoneForLocalPoint(0.45, 0, 0.5, 0.5).id).toBe('front+right')
    expect(zoneForLocalPoint(0.5, 0, 0.45, 0.5).id).toBe('front+right')
  })

  it('classifies corner regions as three-face corners', () => {
    expect(zoneForLocalPoint(0.48, 0.48, 0.5, 0.5).id).toBe('front+right+top')
    expect(zoneForLocalPoint(-0.48, -0.48, -0.5, 0.5).id).toBe('back+bottom+left')
  })

  it('is exact on the border: u = ±0.5 belongs to the edge', () => {
    expect(zoneForLocalPoint(0, 0.5, 0.5, 0.5).id).toBe('front+top')
  })

  it('face center is stable for any half size', () => {
    expect(zoneForLocalPoint(0, 0, 7, 7).faces).toEqual(['front'])
    expect(zoneForLocalPoint(0, 0.1, 7, 7).faces).toEqual(['front'])
  })
})

describe('viewDirForZone', () => {
  it('returns face normals for single faces', () => {
    expect(viewDirForZone(['top'])).toEqual({ x: 0, y: 1, z: 0 })
    expect(viewDirForZone(['front'])).toEqual({ x: 0, y: 0, z: 1 })
  })

  it('normalizes edge and corner directions', () => {
    const edge = viewDirForZone(['front', 'top'])
    expect(edge.x).toBeCloseTo(0)
    expect(edge.y).toBeCloseTo(Math.SQRT1_2)
    expect(edge.z).toBeCloseTo(Math.SQRT1_2)

    const corner = viewDirForZone(['front', 'right', 'top'])
    for (const v of Object.values(corner)) expect(v).toBeCloseTo(Math.sqrt(1 / 3))
  })

  it('has a direction for every FACE_DIRS entry', () => {
    for (const [name, dir] of Object.entries(FACE_DIRS)) {
      expect(viewDirForZone([name as keyof typeof FACE_DIRS])).toEqual(dir)
    }
  })
})

describe('sphericalFor', () => {
  it('matches three.js spherical conventions', () => {
    expect(sphericalFor({ x: 0, y: 0, z: 1 })).toEqual({ theta: 0, phi: Math.PI / 2 })
    expect(sphericalFor({ x: 1, y: 0, z: 0 }).theta).toBeCloseTo(Math.PI / 2)
  })

  it('clamps phi away from the poles to keep lookAt well-defined', () => {
    expect(sphericalFor({ x: 0, y: 1, z: 0 }).phi).toBeGreaterThan(0)
    expect(sphericalFor({ x: 0, y: -1, z: 0 }).phi).toBeLessThan(Math.PI)
    expect(sphericalFor({ x: 0, y: 1, z: 0 }).phi).toBe(0.02)
  })
})

describe('easeInOutCubic', () => {
  it('is 0 at 0, 1 at 1, and symmetric around the middle', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
    expect(easeInOutCubic(0.25)).toBeCloseTo(1 - easeInOutCubic(0.75))
  })

  it('clamps out-of-range input', () => {
    expect(easeInOutCubic(-1)).toBe(0)
    expect(easeInOutCubic(2)).toBe(1)
  })
})
