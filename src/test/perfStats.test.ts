import { describe, expect, it } from 'vitest'
import { createPerfStats } from '../lib/perfStats'

describe('perfStats', () => {
  it('aggregates quantize and rebuild timings with averages', () => {
    const perf = createPerfStats()
    perf.recordQuantize(10)
    perf.recordQuantize(30)
    perf.recordRebuild(4.5)

    const s = perf.snapshot()
    expect(s.quantize.count).toBe(2)
    expect(s.quantize.lastMs).toBe(30)
    expect(s.quantize.totalMs).toBe(40)
    expect(s.quantize.avgMs).toBeCloseTo(20, 6)
    expect(s.rebuild.count).toBe(1)
    expect(s.rebuild.lastMs).toBe(4.5)
    expect(s.rebuild.avgMs).toBe(4.5)
  })

  it('clamps negative timings to zero', () => {
    const perf = createPerfStats()
    perf.recordQuantize(-5)
    expect(perf.snapshot().quantize.totalMs).toBe(0)
    expect(perf.snapshot().quantize.avgMs).toBe(0)
  })

  it('counts discarded responses by kind', () => {
    const perf = createPerfStats()
    perf.recordDiscarded('quantize')
    perf.recordDiscarded('rebuild')
    perf.recordDiscarded('rebuild')

    const s = perf.snapshot()
    expect(s.discarded.quantize).toBe(1)
    expect(s.discarded.rebuild).toBe(2)
    expect(s.discarded.total).toBe(3)
  })

  it('tracks buffer and mesh sizes', () => {
    const perf = createPerfStats()
    perf.recordBuffers({
      rgbaBytes: 128 * 128 * 4,
      indexBytes: 128 * 128,
      fieldBytes: 128 * 128 * 4,
      width: 128,
      height: 128,
    })
    perf.recordMesh(1000)

    const s = perf.snapshot()
    expect(s.buffers.rgbaBytes).toBe(65536)
    expect(s.buffers.indexBytes).toBe(16384)
    expect(s.buffers.fieldBytes).toBe(65536)
    expect(s.buffers.triangles).toBe(1000)
    // 36 bytes per triangle: positions (3 floats) + colors (3 floats).
    expect(s.buffers.meshBytes).toBe(36000)
    expect(s.buffers.width).toBe(128)
    expect(s.buffers.height).toBe(128)
  })

  it('keeps mesh size when only buffers are re-recorded', () => {
    const perf = createPerfStats()
    perf.recordMesh(500)
    perf.recordBuffers({ rgbaBytes: 1, indexBytes: 1, fieldBytes: 1, width: 1, height: 1 })
    expect(perf.snapshot().buffers.meshBytes).toBe(18000)
    expect(perf.snapshot().buffers.triangles).toBe(500)
  })

  it('reset clears everything', () => {
    const perf = createPerfStats()
    perf.recordQuantize(10)
    perf.recordDiscarded('rebuild')
    perf.recordBuffers({ rgbaBytes: 1, indexBytes: 1, fieldBytes: 1, width: 1, height: 1 })
    perf.recordMesh(10)
    perf.reset()

    const s = perf.snapshot()
    expect(s.quantize.count).toBe(0)
    expect(s.rebuild.count).toBe(0)
    expect(s.discarded.total).toBe(0)
    expect(s.buffers.rgbaBytes).toBe(0)
    expect(s.buffers.triangles).toBe(0)
  })
})