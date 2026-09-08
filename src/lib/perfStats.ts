/**
 * Lightweight performance monitoring for the pipeline: quantization and
 * mesh-rebuild timings, discarded worker responses (superseded by a newer
 * run), and the sizes of the big buffers the pipeline moves around.
 *
 * Pure module — no DOM, no worker globals — so the collector is directly
 * unit-testable in Node. The UI module renders `snapshot()`.
 */

export interface PerfTiming {
  count: number
  lastMs: number
  totalMs: number
  avgMs: number
}

export interface PerfBuffers {
  /** RGBA bytes of the loaded (print-sized) image on the main thread. */
  rgbaBytes: number
  /** indexMap bytes (1 byte per pixel). */
  indexBytes: number
  /** HeightField bytes (4 bytes per pixel, Float32). */
  fieldBytes: number
  /** Mesh vertex buffers: 36 bytes per triangle (xyz + rgb, both Float32). */
  meshBytes: number
  triangles: number
  width: number
  height: number
}

export interface PerfSnapshot {
  quantize: PerfTiming
  rebuild: PerfTiming
  discarded: { quantize: number; rebuild: number; total: number }
  buffers: PerfBuffers
}

export interface PerfStats {
  recordQuantize(ms: number): void
  recordRebuild(ms: number): void
  recordDiscarded(kind: 'quantize' | 'rebuild'): void
  recordBuffers(b: {
    rgbaBytes: number
    indexBytes: number
    fieldBytes: number
    width: number
    height: number
  }): void
  recordMesh(triangles: number): void
  snapshot(): PerfSnapshot
  reset(): void
}

const EMPTY_BUFFERS: PerfBuffers = {
  rgbaBytes: 0,
  indexBytes: 0,
  fieldBytes: 0,
  meshBytes: 0,
  triangles: 0,
  width: 0,
  height: 0,
}

function emptyTiming(): PerfTiming {
  return { count: 0, lastMs: 0, totalMs: 0, avgMs: 0 }
}

export function createPerfStats(): PerfStats {
  let quantize = emptyTiming()
  let rebuild = emptyTiming()
  let discardedQuantize = 0
  let discardedRebuild = 0
  let buffers: PerfBuffers = { ...EMPTY_BUFFERS }

  const record = (t: PerfTiming, ms: number): PerfTiming => {
    const count = t.count + 1
    const totalMs = t.totalMs + Math.max(0, ms)
    return { count, lastMs: Math.max(0, ms), totalMs, avgMs: count > 0 ? totalMs / count : 0 }
  }

  return {
    recordQuantize(ms) {
      quantize = record(quantize, ms)
    },
    recordRebuild(ms) {
      rebuild = record(rebuild, ms)
    },
    recordDiscarded(kind) {
      if (kind === 'quantize') discardedQuantize++
      else discardedRebuild++
    },
    recordBuffers(b) {
      buffers = {
        rgbaBytes: b.rgbaBytes,
        indexBytes: b.indexBytes,
        fieldBytes: b.fieldBytes,
        meshBytes: buffers.meshBytes,
        triangles: buffers.triangles,
        width: b.width,
        height: b.height,
      }
    },
    recordMesh(triangles) {
      // 36 bytes per triangle: positions (3 floats) + colors (3 floats).
      buffers = { ...buffers, meshBytes: triangles * 36, triangles }
    },
    snapshot() {
      return {
        quantize: { ...quantize },
        rebuild: { ...rebuild },
        discarded: {
          quantize: discardedQuantize,
          rebuild: discardedRebuild,
          total: discardedQuantize + discardedRebuild,
        },
        buffers: { ...buffers },
      }
    },
    reset() {
      quantize = emptyTiming()
      rebuild = emptyTiming()
      discardedQuantize = 0
      discardedRebuild = 0
      buffers = { ...EMPTY_BUFFERS }
    },
  }
}