import { crc32 as zlibCrc32 } from 'node:zlib'
import { zlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { decodePng, PngError, PNG_MAX_SIDE } from '../lib/depth/png'
import { importDepthFromPng } from '../lib/depth/importMap'
import { normalizeMinMax, resampleDepth } from '../lib/depth/depthMap'

// ---- an independent PNG encoder (forward filters), so the decoder is not tested against itself ----

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, zlibCrc32(out.subarray(4, 8 + data.length)) >>> 0)
  return out
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

interface PngSpec {
  width: number
  height: number
  colorType: 0 | 2 | 4 | 6
  bitDepth: 8 | 16
  /** One sample value per channel per pixel, row-major: 0..255 or 0..65535. */
  samples: number[]
  /** Filter type per row (cycled); default none. */
  filters?: number[]
  interlace?: number
}

function encodePng(spec: PngSpec): Uint8Array {
  const channels = CHANNELS[spec.colorType]!
  const bytesPerSample = spec.bitDepth / 8
  const bpp = channels * bytesPerSample
  const rowBytes = spec.width * bpp
  const rows: Uint8Array[] = []
  for (let y = 0; y < spec.height; y++) {
    const row = new Uint8Array(rowBytes)
    for (let x = 0; x < spec.width * channels; x++) {
      const v = spec.samples[y * spec.width * channels + x]!
      if (bytesPerSample === 2) {
        row[x * 2] = v >> 8
        row[x * 2 + 1] = v & 0xff
      } else row[x] = v
    }
    rows.push(row)
  }
  const raw = new Uint8Array((rowBytes + 1) * spec.height)
  for (let y = 0; y < spec.height; y++) {
    const filter = (spec.filters ?? [0])[y % (spec.filters ?? [0]).length]!
    raw[y * (rowBytes + 1)] = filter
    for (let x = 0; x < rowBytes; x++) {
      const left = x >= bpp ? rows[y]![x - bpp]! : 0
      const up = y > 0 ? rows[y - 1]![x]! : 0
      const upLeft = y > 0 && x >= bpp ? rows[y - 1]![x - bpp]! : 0
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter]!
      raw[y * (rowBytes + 1) + 1 + x] = (rows[y]![x]! - predictor) & 0xff
    }
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, spec.width)
  dv.setUint32(4, spec.height)
  ihdr[8] = spec.bitDepth
  ihdr[9] = spec.colorType
  ihdr[12] = spec.interlace ?? 0
  return concat([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ])
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** A `w × h` gray gradient with distinct, pseudo-varied values (so every filter has work to do). */
function graySamples(w: number, h: number, max: number): number[] {
  return Array.from({ length: w * h }, (_, i) => Math.round((((i * 37) % 251) / 250) * max))
}

// ---- decoding ----

describe('decodePng', () => {
  for (const [name, filter] of [['none', 0], ['sub', 1], ['up', 2], ['average', 3], ['paeth', 4]] as const) {
    it(`reads 8-bit gray through the ${name} scanline filter`, () => {
      const samples = graySamples(9, 7, 255)
      const png = decodePng(encodePng({ width: 9, height: 7, colorType: 0, bitDepth: 8, samples, filters: [filter] }))
      expect(png.width).toBe(9)
      expect(png.height).toBe(7)
      expect(png.bitDepth).toBe(8)
      expect(Array.from(png.luma).map((v) => Math.round(v * 255))).toEqual(samples)
    })

    it(`reads 16-bit gray through the ${name} scanline filter`, () => {
      const samples = graySamples(9, 7, 65535)
      const png = decodePng(encodePng({ width: 9, height: 7, colorType: 0, bitDepth: 16, samples, filters: [filter] }))
      expect(png.bitDepth).toBe(16)
      expect(Array.from(png.luma).map((v) => Math.round(v * 65535))).toEqual(samples)
    })
  }

  it('reads a picture whose rows use different filters', () => {
    const samples = graySamples(11, 10, 255)
    const png = decodePng(
      encodePng({ width: 11, height: 10, colorType: 0, bitDepth: 8, samples, filters: [0, 1, 2, 3, 4, 4, 3, 2, 1, 0] }),
    )
    expect(Array.from(png.luma).map((v) => Math.round(v * 255))).toEqual(samples)
  })

  it('keeps every level of a 16-bit ramp (a canvas would keep 256 of them)', () => {
    const width = 1000
    const samples = Array.from({ length: width }, (_, x) => x * 60)
    const png = decodePng(encodePng({ width, height: 1, colorType: 0, bitDepth: 16, samples, filters: [1] }))
    expect(new Set(png.luma).size).toBe(width)
    expect(png.luma[999]).toBeCloseTo((999 * 60) / 65535, 6)
  })

  it('converts RGB to brightness with Rec.709 weights', () => {
    const png = decodePng(
      encodePng({ width: 2, height: 1, colorType: 2, bitDepth: 8, samples: [255, 0, 0, 0, 255, 0], filters: [4] }),
    )
    expect(png.luma[0]).toBeCloseTo(0.2126, 4)
    expect(png.luma[1]).toBeCloseTo(0.7152, 4)
    expect(png.alpha).toBeUndefined()
  })

  it('reads 16-bit RGB', () => {
    const png = decodePng(
      encodePng({ width: 1, height: 1, colorType: 2, bitDepth: 16, samples: [65535, 65535, 65535], filters: [2] }),
    )
    expect(png.luma[0]).toBeCloseTo(1, 5)
  })

  it('reads gray+alpha and RGBA, keeping alpha apart from brightness', () => {
    const ga = decodePng(
      encodePng({ width: 2, height: 1, colorType: 4, bitDepth: 8, samples: [200, 255, 100, 0], filters: [1] }),
    )
    expect(ga.luma[0]).toBeCloseTo(200 / 255, 6)
    expect(ga.alpha![0]).toBeCloseTo(1, 6)
    expect(ga.alpha![1]).toBe(0)
    const rgba = decodePng(
      encodePng({ width: 1, height: 1, colorType: 6, bitDepth: 16, samples: [0, 0, 0, 32768], filters: [3] }),
    )
    expect(rgba.alpha![0]).toBeCloseTo(32768 / 65535, 6)
  })
})

describe('decodePng refuses what it cannot read faithfully', () => {
  const good = () => encodePng({ width: 4, height: 4, colorType: 0, bitDepth: 8, samples: graySamples(4, 4, 255) })
  const codeOf = (bytes: Uint8Array): string | undefined => {
    try {
      decodePng(bytes)
    } catch (err) {
      return err instanceof PngError ? err.code : `other: ${String(err)}`
    }
    return undefined
  }

  it('rejects a file that is not a PNG', () => {
    expect(codeOf(new TextEncoder().encode('GIF89a not a png at all'))).toBe('not-png')
    expect(codeOf(new Uint8Array(0))).toBe('not-png')
  })

  it('rejects a corrupted chunk by its checksum', () => {
    const bytes = good()
    bytes[bytes.length - 20] ^= 0xff // inside IDAT
    expect(codeOf(bytes)).toBe('corrupt')
  })

  it('rejects a truncated file', () => {
    const bytes = good()
    expect(codeOf(bytes.subarray(0, bytes.length - 20))).toBe('corrupt')
    expect(codeOf(bytes.subarray(0, 40))).toBe('corrupt')
  })

  it('names interlaced files instead of misreading them', () => {
    const png = encodePng({ width: 4, height: 4, colorType: 0, bitDepth: 8, samples: graySamples(4, 4, 255), interlace: 1 })
    expect(codeOf(png)).toBe('interlaced')
  })

  it('refuses color types and depths it does not handle', () => {
    for (const [colorType, bitDepth] of [[3, 8], [0, 1], [0, 4], [2, 4]] as const) {
      const ihdr = new Uint8Array(13)
      const dv = new DataView(ihdr.buffer)
      dv.setUint32(0, 2)
      dv.setUint32(4, 2)
      ihdr[8] = bitDepth
      ihdr[9] = colorType
      const bytes = concat([
        Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlibSync(new Uint8Array(20))),
        chunk('IEND', new Uint8Array(0)),
      ])
      expect(codeOf(bytes), `type ${colorType} @ ${bitDepth}`).toBe('unsupported')
    }
  })

  it('refuses an absurd size before allocating for it', () => {
    const ihdr = new Uint8Array(13)
    const dv = new DataView(ihdr.buffer)
    dv.setUint32(0, PNG_MAX_SIDE + 1)
    dv.setUint32(4, 10)
    ihdr[8] = 8
    ihdr[9] = 0
    const bytes = concat([
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlibSync(new Uint8Array(10))),
      chunk('IEND', new Uint8Array(0)),
    ])
    expect(codeOf(bytes)).toBe('too-large')
  })

  it('does not inflate a stream past the size the header promises', () => {
    // A 4×4 gray header, but the compressed data expands to a megabyte.
    const ihdr = new Uint8Array(13)
    const dv = new DataView(ihdr.buffer)
    dv.setUint32(0, 4)
    dv.setUint32(4, 4)
    ihdr[8] = 8
    ihdr[9] = 0
    const bytes = concat([
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlibSync(new Uint8Array(1_000_000))),
      chunk('IEND', new Uint8Array(0)),
    ])
    expect(codeOf(bytes)).toBe('corrupt')
  })

  it('rejects image data shorter than the header says', () => {
    const ihdr = new Uint8Array(13)
    const dv = new DataView(ihdr.buffer)
    dv.setUint32(0, 8)
    dv.setUint32(4, 8)
    ihdr[8] = 8
    ihdr[9] = 0
    const bytes = concat([
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlibSync(new Uint8Array(20))),
      chunk('IEND', new Uint8Array(0)),
    ])
    expect(codeOf(bytes)).toBe('corrupt')
  })
})

// ---- turning a decoded PNG into a depth map ----

describe('importDepthFromPng', () => {
  it('stretches the file to 0..1 without clipping its extremes', () => {
    const width = 200
    const samples = Array.from({ length: width }, (_, x) => 10000 + x * 100)
    const { map, bitDepth, hadBackground, flat } = importDepthFromPng(
      encodePng({ width, height: 1, colorType: 0, bitDepth: 16, samples }),
    )
    expect(bitDepth).toBe(16)
    expect(hadBackground).toBe(false)
    expect(flat).toBe(false)
    expect(map.data[0]).toBe(0)
    expect(map.data[width - 1]).toBe(1)
    for (let i = 1; i < width; i++) expect(map.data[i]!).toBeGreaterThan(map.data[i - 1]!)
  })

  it('treats fully transparent pixels as background and leaves them out of the range', () => {
    // Pixels: opaque 100, opaque 200, transparent 255 (must NOT set the maximum).
    const { map, hadBackground } = importDepthFromPng(
      encodePng({ width: 3, height: 1, colorType: 4, bitDepth: 8, samples: [100, 255, 200, 255, 255, 0] }),
    )
    expect(hadBackground).toBe(true)
    expect(map.data[0]).toBe(0)
    expect(map.data[1]).toBe(1)
    expect(map.data[2]).toBe(0)
  })

  it('reports a solid picture as flat instead of inventing a range', () => {
    const { flat, map } = importDepthFromPng(
      encodePng({ width: 4, height: 4, colorType: 0, bitDepth: 8, samples: new Array(16).fill(128) }),
    )
    expect(flat).toBe(true)
    expect(map.data.every((v) => v === 0)).toBe(true)
  })
})

describe('normalizeMinMax', () => {
  it('ignores non-finite values and never emits NaN', () => {
    const { data, flat } = normalizeMinMax(Float32Array.from([NaN, 2, 4, Infinity]))
    expect(flat).toBe(false)
    expect(Array.from(data)).toEqual([0, 0, 1, 0])
  })
})

describe('resampleDepth when shrinking a lot', () => {
  it('averages fine detail instead of sampling one pixel in many', () => {
    // A 1-px checkerboard of 0 and 1, read at a quarter of its size, must average to ~0.5.
    const n = 64
    const data = new Float32Array(n * n)
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) data[y * n + x] = (x + y) % 2
    const small = resampleDepth({ width: n, height: n, data }, 16, 16)
    for (const v of small.data) expect(v).toBeCloseTo(0.5, 2)
  })
})
