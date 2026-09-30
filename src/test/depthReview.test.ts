import { strFromU8, unzipSync, zlibSync } from 'fflate'
import { crc32 as zlibCrc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { depthToRelief, fitDepthWithin, resampleDepth, type DepthMap } from '../lib/depth/depthMap'
import { IMPORT_KEEP_SIDE, importDepthFromPng } from '../lib/depth/importMap'
import { decodePng, PngError, PNG_MAX_PIXELS } from '../lib/depth/png'
import { describeExport } from '../lib/describe'
import { export3mfFile, finishPipeline, type PipelineResult } from '../lib/pipeline'
import { buildProjectFile, parseProjectFile, ProjectFileError } from '../lib/project'
import { mapToLuminanceBands } from '../lib/quantize'

// ---- an invert must not reach a transparent background ----

describe('depthToRelief keeps a background at the base whichever way the depth runs', () => {
  const map: DepthMap = { width: 2, height: 1, data: Float32Array.from([0.8, 0]) }
  const background: DepthMap = { width: 2, height: 1, data: Float32Array.from([0, 1]) }

  it('leaves the background at 0 with and without the flip', () => {
    expect(Array.from(depthToRelief(map, 2, 1, false, background))).toEqual([expect.closeTo(0.8, 6), 0])
    // Without the mask the flip would raise it to 1: the whole cut-out surround becomes a plateau.
    expect(depthToRelief(map, 2, 1, true)[1]).toBe(1)
    expect(Array.from(depthToRelief(map, 2, 1, true, background))).toEqual([expect.closeTo(0.2, 6), 0])
  })

  it('pulls an edge pixel that is half background half way to the base', () => {
    const half: DepthMap = { width: 1, height: 1, data: Float32Array.from([1]) }
    const cover: DepthMap = { width: 1, height: 1, data: Float32Array.from([0.5]) }
    expect(depthToRelief(half, 1, 1, false, cover)[0]).toBeCloseTo(0.5, 6)
  })
})

describe('resampleDepth and fitDepthWithin', () => {
  it('filters a 2.7× shrink instead of sampling one pixel in three', () => {
    // A 1-px checkerboard: any 2×2 block averages to exactly 0.5. Halving the
    // ratio before the block pass left this shrink to bilinear alone.
    const n = 108
    const data = new Float32Array(n * n)
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) data[y * n + x] = (x + y) % 2
    const out = resampleDepth({ width: n, height: n, data }, 40, 40)
    for (const v of out.data) expect(v).toBeGreaterThan(0.45)
    for (const v of out.data) expect(v).toBeLessThan(0.55)
  })

  it('shrinks a map by whole blocks until it fits, and leaves a small one alone', () => {
    const big: DepthMap = { width: 3000, height: 10, data: new Float32Array(30000).fill(0.4) }
    const fitted = fitDepthWithin(big, IMPORT_KEEP_SIDE)
    expect(Math.max(fitted.width, fitted.height)).toBeLessThanOrEqual(IMPORT_KEEP_SIDE)
    expect(fitted.data[0]).toBeCloseTo(0.4, 6)
    const small: DepthMap = { width: 100, height: 100, data: new Float32Array(10000) }
    expect(fitDepthWithin(small, IMPORT_KEEP_SIDE)).toBe(small)
  })
})

// ---- a plateau stays one band ----

describe('a depth relief keeps a plateau in one band', () => {
  const W = 20
  const H = 20
  const picture = new Uint8ClampedArray(W * H * 4).fill(255)

  it('puts a flat background at the base, whole — not striped by raster order', () => {
    // 60 % of the picture is background (0), the rest a ramp: the background
    // straddles the first two band boundaries of a 4-band split.
    const field = new Float32Array(W * H)
    for (let i = 0; i < field.length; i++) field[i] = i < W * H * 0.6 ? 0 : 0.2 + (0.8 * (i - W * H * 0.6)) / (W * H * 0.4)
    const q = mapToLuminanceBands(picture, 4, W, H, false, 0, undefined, undefined, 0, field)
    const backgroundBands = new Set<number>()
    for (let i = 0; i < W * H * 0.6; i++) backgroundBands.add(q.indexMap[i]!)
    expect([...backgroundBands]).toEqual([0])
  })

  it('does not stripe a flat field either (a flat map is one band, not four)', () => {
    const q = mapToLuminanceBands(picture, 4, W, H, false, 0, undefined, undefined, 0, new Float32Array(W * H))
    expect(new Set(q.indexMap).size).toBe(1)
  })
})

// ---- exports say what the relief really is ----

function pipelineResult(relief?: PipelineResult['relief']): PipelineResult {
  const size = 16
  const rgba = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < size * size; i++) rgba.set([i % 251, (i * 3) % 251, 90, 255], i * 4)
  const image = { width: size, height: size, rgba }
  const q = mapToLuminanceBands(rgba, 4, size, size, false)
  const result = finishPipeline(image, q, {
    numColors: 4,
    darkIsTall: false,
    widthMm: 40,
    heightMm: 40,
    baseMm: 0.8,
    maxHeightMm: 8,
    layerMm: 0.2,
  })
  return relief ? { ...result, relief } : result
}

describe('exports of a depth relief', () => {
  it('Describe.txt no longer claims that bright areas stand tallest', () => {
    const brightness = describeExport(pipelineResult(), 'x')
    expect(brightness).toContain('bright image areas stand tallest')
    const nearest = describeExport(pipelineResult({ source: 'depth', invert: false }), 'x')
    expect(nearest).not.toContain('bright image areas')
    expect(nearest).toContain('neural network')
    expect(nearest).toContain('nearest areas stand tallest')
    const farthest = describeExport(pipelineResult({ source: 'file', invert: true }), 'x')
    expect(farthest).toContain('farthest areas stand tallest')
    expect(farthest).toContain('(file)')
  })

  it('records the relief source in the 3MF metadata, and nothing extra for a brightness relief', () => {
    const textOf = (bytes: Uint8Array) =>
      Object.values(unzipSync(bytes))
        .map((f) => strFromU8(f))
        .join('\n')
    const depth = textOf(export3mfFile(pipelineResult({ source: 'depth', invert: true }), 'x'))
    expect(depth).toContain('ReliefSource')
    expect(depth).toMatch(/InvertDepth[^>]*>?[^<]*true/)
    expect(textOf(export3mfFile(pipelineResult(), 'x'))).not.toContain('ReliefSource')
  })
})

// ---- a project carries the map its palette belongs to ----

function projectJson(overrides: Record<string, unknown> = {}) {
  const base = buildProjectFile({
    imageName: 'p.png',
    dataUrl: 'data:image/png;base64,AAAA',
    settings: { colors: 4, widthMm: 100, heightMm: 100, baseMm: 0.8, maxMm: 8, layerMm: 0.2, dither: 0, darkIsTall: false, backlight: false },
    palette: [{ hex: '#112233', tauMm: 0.3 }],
  })
  return JSON.stringify({ ...base, ...overrides })
}

describe('project files with an embedded depth map', () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo='

  it('roundtrips the map and its name', () => {
    const built = buildProjectFile({
      imageName: 'p.png',
      dataUrl: 'data:image/png;base64,AAAA',
      depthMap: { name: 'ramp.png', dataUrl },
      settings: { colors: 4, widthMm: 100, heightMm: 100, baseMm: 0.8, maxMm: 8, layerMm: 0.2, dither: 0, darkIsTall: false, backlight: false, reliefSource: 'file', invertDepth: true },
      palette: [{ hex: '#112233', tauMm: 0.3 }],
    })
    const parsed = parseProjectFile(JSON.stringify(built))
    expect(parsed.depthMap).toEqual({ name: 'ramp.png', dataUrl })
    expect(parsed.settings.reliefSource).toBe('file')
  })

  it('refuses a file source with no map to build it from', () => {
    const noMap = JSON.parse(projectJson())
    noMap.settings.reliefSource = 'file'
    expect(() => parseProjectFile(JSON.stringify(noMap))).toThrow(ProjectFileError)
  })

  it('refuses a map that is not a PNG data URL, or is absurdly large', () => {
    expect(() => parseProjectFile(projectJson({ depthMap: { name: 'a', dataUrl: 'data:text/plain;base64,AAAA' } }))).toThrow(ProjectFileError)
    expect(() => parseProjectFile(projectJson({ depthMap: { name: '', dataUrl } }))).toThrow(ProjectFileError)
    expect(() => parseProjectFile(projectJson({ depthMap: 'nope' }))).toThrow(ProjectFileError)
    const huge = `data:image/png;base64,${'A'.repeat(90 * 1024 * 1024)}`
    expect(() => parseProjectFile(projectJson({ depthMap: { name: 'big.png', dataUrl: huge } }))).toThrow(ProjectFileError)
  })

  it('leaves a project without a map exactly as before', () => {
    expect(parseProjectFile(projectJson()).depthMap).toBeUndefined()
  })
})

// ---- imported maps: memory stays bounded ----

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, zlibCrc32(out.subarray(4, 8 + data.length)) >>> 0)
  return out
}

function headerOnlyPng(width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 0
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(new Uint8Array(10))),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('imported map limits', () => {
  it('refuses an image past the pixel cap before allocating for it', () => {
    // 5000 × 5000 = 25 MP: each side is fine, the product is not.
    expect(5000 * 5000).toBeGreaterThan(PNG_MAX_PIXELS)
    try {
      decodePng(headerOnlyPng(5000, 5000))
      expect.unreachable('should have refused')
    } catch (err) {
      expect(err).toBeInstanceOf(PngError)
      expect((err as PngError).code).toBe('too-large')
    }
  })

  it('keeps a background map alongside the depth, both bounded in size', () => {
    // 4 × 1 gray+alpha: three opaque pixels and one fully transparent.
    const samples = [10, 255, 200, 255, 90, 255, 255, 0]
    const png = encodeGrayAlpha(4, 1, samples)
    const imported = importDepthFromPng(png)
    expect(imported.hadBackground).toBe(true)
    expect(Array.from(imported.background!.data)).toEqual([0, 0, 0, 1])
    expect(imported.map.data[3]).toBe(0)
  })
})

function encodeGrayAlpha(width: number, height: number, samples: number[]): Uint8Array {
  const rowBytes = width * 2
  const raw = new Uint8Array((rowBytes + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < rowBytes; x++) raw[y * (rowBytes + 1) + 1 + x] = samples[y * rowBytes + x]!
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 4
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
