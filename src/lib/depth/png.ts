import { unzlibSync } from 'fflate'

/**
 * A small PNG decoder for depth / height maps.
 *
 * Why not `<canvas>`: drawing a PNG onto a canvas reduces it to 8 bits per
 * channel, and a 16-bit depth map (the usual output of depth tools) would lose
 * 255 of every 256 levels — a smooth ramp would print as terraces. This reads
 * the samples as stored.
 *
 * Scope: gray, gray+alpha, RGB and RGBA at 8 or 16 bits, all five scanline
 * filters, no interlacing. Anything else is refused with a typed error rather
 * than guessed at.
 */

export type PngErrorCode = 'not-png' | 'corrupt' | 'interlaced' | 'unsupported' | 'too-large'

export class PngError extends Error {
  readonly code: PngErrorCode
  constructor(code: PngErrorCode, message: string) {
    super(message)
    this.name = 'PngError'
    this.code = code
  }
}

/**
 * Largest side, pixel count and raw (unfiltered) sample buffer the decoder
 * accepts. The pixel cap is what keeps memory honest: decoding runs on the main
 * thread and holds the raw data, the unfiltered rows and two Float32 planes at
 * once, so 16 megapixels (4096 × 4096) is already a few hundred MB in flight.
 */
export const PNG_MAX_SIDE = 16384
export const PNG_MAX_PIXELS = 16 * 1024 * 1024
export const PNG_MAX_RAW_BYTES = 128 * 1024 * 1024

export interface DecodedPng {
  width: number
  height: number
  /** 8 or 16. */
  bitDepth: 8 | 16
  /** PNG color type: 0 gray, 2 RGB, 4 gray+alpha, 6 RGBA. */
  colorType: 0 | 2 | 4 | 6
  /** Brightness per pixel, 0..1 at the file's own precision (Rec.709 weights for RGB). */
  luma: Float32Array
  /** Alpha per pixel, 0..1; present only for color types 4 and 6. */
  alpha?: Float32Array
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

let crcTable: Uint32Array | null = null
function crc32(bytes: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }

/** Paeth predictor (PNG spec §9.4). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Undo the per-scanline filters in place; `raw` holds `height` rows of `1 + rowBytes`. */
function unfilter(raw: Uint8Array, height: number, bpp: number, rowBytes: number): Uint8Array {
  const out = new Uint8Array(rowBytes * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)]!
    const src = y * (rowBytes + 1) + 1
    const dst = y * rowBytes
    const prev = dst - rowBytes
    if (filter > 4) throw new PngError('corrupt', `unknown scanline filter ${filter}`)
    for (let x = 0; x < rowBytes; x++) {
      const left = x >= bpp ? out[dst + x - bpp]! : 0
      const up = y > 0 ? out[prev + x]! : 0
      const upLeft = y > 0 && x >= bpp ? out[prev + x - bpp]! : 0
      const v = raw[src + x]!
      let add = 0
      if (filter === 1) add = left
      else if (filter === 2) add = up
      else if (filter === 3) add = (left + up) >> 1
      else if (filter === 4) add = paeth(left, up, upLeft)
      out[dst + x] = (v + add) & 0xff
    }
  }
  return out
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  if (bytes.length < 8 || SIGNATURE.some((v, i) => bytes[i] !== v)) {
    throw new PngError('not-png', 'not a PNG file')
  }
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  const idat: Uint8Array[] = []
  let sawEnd = false
  while (pos + 12 <= bytes.length) {
    const length = u32(bytes, pos)
    const typeAt = pos + 4
    const dataAt = pos + 8
    const end = dataAt + length
    if (end + 4 > bytes.length) throw new PngError('corrupt', 'a chunk runs past the end of the file')
    const type = String.fromCharCode(bytes[typeAt]!, bytes[typeAt + 1]!, bytes[typeAt + 2]!, bytes[typeAt + 3]!)
    if (u32(bytes, end) !== crc32(bytes, typeAt, end)) throw new PngError('corrupt', `chunk ${type} fails its checksum`)
    if (type === 'IHDR') {
      if (length !== 13) throw new PngError('corrupt', 'malformed header')
      width = u32(bytes, dataAt)
      height = u32(bytes, dataAt + 4)
      bitDepth = bytes[dataAt + 8]!
      colorType = bytes[dataAt + 9]!
      if (bytes[dataAt + 10] !== 0 || bytes[dataAt + 11] !== 0) throw new PngError('unsupported', 'unknown compression or filter method')
      if (bytes[dataAt + 12] !== 0) throw new PngError('interlaced', 'interlaced PNG is not supported')
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(dataAt, end))
    } else if (type === 'IEND') {
      sawEnd = true
      break
    }
    pos = end + 4
  }
  if (colorType < 0) throw new PngError('corrupt', 'missing header')
  if (!sawEnd || idat.length === 0) throw new PngError('corrupt', 'the file is truncated')
  if (width < 1 || height < 1) throw new PngError('corrupt', 'empty image')
  if (width > PNG_MAX_SIDE || height > PNG_MAX_SIDE || width * height > PNG_MAX_PIXELS) {
    throw new PngError('too-large', 'image is too large')
  }
  const channels = CHANNELS[colorType]
  if (!channels || (bitDepth !== 8 && bitDepth !== 16)) {
    throw new PngError('unsupported', `color type ${colorType} at ${bitDepth} bits is not supported`)
  }
  const bytesPerSample = bitDepth / 8
  const bpp = channels * bytesPerSample
  const rowBytes = width * bpp
  const rawLength = (rowBytes + 1) * height
  if (rawLength > PNG_MAX_RAW_BYTES) throw new PngError('too-large', 'image is too large')

  let total = 0
  for (const part of idat) total += part.length
  const compressed = new Uint8Array(total)
  let at = 0
  for (const part of idat) {
    compressed.set(part, at)
    at += part.length
  }
  let raw: Uint8Array
  try {
    // A preallocated output bounds memory: a corrupt or hostile stream cannot
    // inflate past it — the decoder just stops writing at the end of the buffer.
    // One spare byte makes a stream that promises more than the header says
    // observable (it fills the spare byte) instead of silently truncated.
    raw = unzlibSync(compressed, { out: new Uint8Array(rawLength + 1) })
  } catch {
    throw new PngError('corrupt', 'the image data cannot be decompressed')
  }
  if (raw.length !== rawLength) {
    throw new PngError('corrupt', 'the image data does not match the size in the header')
  }

  const pixels = unfilter(raw, height, bpp, rowBytes)
  const count = width * height
  const luma = new Float32Array(count)
  const hasAlpha = colorType === 4 || colorType === 6
  const alpha = hasAlpha ? new Float32Array(count) : undefined
  const max = bitDepth === 16 ? 65535 : 255
  const sample = (o: number): number => (bitDepth === 16 ? (pixels[o]! << 8) | pixels[o + 1]! : pixels[o]!)
  for (let i = 0; i < count; i++) {
    const o = i * bpp
    if (colorType === 0 || colorType === 4) {
      luma[i] = sample(o) / max
      if (alpha) alpha[i] = sample(o + bytesPerSample) / max
    } else {
      luma[i] =
        (0.2126 * sample(o) + 0.7152 * sample(o + bytesPerSample) + 0.0722 * sample(o + 2 * bytesPerSample)) / max
      if (alpha) alpha[i] = sample(o + 3 * bytesPerSample) / max
    }
  }
  return { width, height, bitDepth: bitDepth as 8 | 16, colorType: colorType as 0 | 2 | 4 | 6, luma, alpha }
}
