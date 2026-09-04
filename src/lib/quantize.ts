import type { QuantizedImage, RGB } from './types'

interface Box {
  start: number
  end: number
}

/**
 * Reduce an image to `numColors` colors using median cut.
 * Returns a palette (not yet luminance-sorted).
 */
export function quantize(rgba: Uint8ClampedArray, numColors: number): RGB[] {
  const pixelCount = rgba.length / 4
  if (pixelCount === 0) return [{ r: 0, g: 0, b: 0 }]

  // Pack RGB triples into a flat Float32Array for fast access.
  const pixels = new Float32Array(pixelCount * 3)
  for (let i = 0; i < pixelCount; i++) {
    pixels[i * 3] = rgba[i * 4]
    pixels[i * 3 + 1] = rgba[i * 4 + 1]
    pixels[i * 3 + 2] = rgba[i * 4 + 2]
  }

  const order = new Uint32Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) order[i] = i

  const boxes: Box[] = [{ start: 0, end: pixelCount }]

  const rangeCache = new Map<number, [number, number, number]>()

  function boxRange(box: Box): [number, number, number] {
    const key = box.start * pixelCount + box.end
    const cached = rangeCache.get(key)
    if (cached) return cached
    let minR = 255, minG = 255, minB = 255
    let maxR = 0, maxG = 0, maxB = 0
    for (let k = box.start; k < box.end; k++) {
      const p = order[k] * 3
      const r = pixels[p], g = pixels[p + 1], b = pixels[p + 2]
      if (r < minR) minR = r
      if (g < minG) minG = g
      if (b < minB) minB = b
      if (r > maxR) maxR = r
      if (g > maxG) maxG = g
      if (b > maxB) maxB = b
    }
    const range: [number, number, number] = [maxR - minR, maxG - minG, maxB - minB]
    rangeCache.set(key, range)
    return range
  }

  while (boxes.length < numColors) {
    // Pick the box with the largest (count × range) score.
    let bestIdx = -1
    let bestScore = 0
    let bestRange: [number, number, number] = [0, 0, 0]
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      const count = box.end - box.start
      if (count < 2) continue
      const range = boxRange(box)
      const rangeSum = range[0] + range[1] + range[2]
      const score = count * rangeSum
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
        bestRange = range
      }
    }
    if (bestIdx === -1) break // nothing left to split

    const box = boxes[bestIdx]
    // Channel with the largest range drives the sort.
    const channel = bestRange[0] >= bestRange[1]
      ? (bestRange[0] >= bestRange[2] ? 0 : 2)
      : (bestRange[1] >= bestRange[2] ? 1 : 2)

    const slice = order.subarray(box.start, box.end)
    // Sort indices by that channel (stable enough for our purposes).
    Array.prototype.sort.call(slice, (a: number, b: number) => {
      return pixels[a * 3 + channel] - pixels[b * 3 + channel]
    })

    const mid = box.start + Math.floor((box.end - box.start) / 2)
    const left: Box = { start: box.start, end: mid }
    const right: Box = { start: mid, end: box.end }
    boxes.splice(bestIdx, 1, left, right)
  }

  // Average each box → palette color.
  const palette: RGB[] = []
  for (const box of boxes) {
    let r = 0, g = 0, b = 0
    for (let k = box.start; k < box.end; k++) {
      const p = order[k] * 3
      r += pixels[p]
      g += pixels[p + 1]
      b += pixels[p + 2]
    }
    const n = Math.max(1, box.end - box.start)
    palette.push({ r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) })
  }

  // If the image had fewer distinct colors than requested, pad with duplicates
  // of the last color so the requested band count still works.
  while (palette.length < numColors) {
    palette.push({ ...palette[palette.length - 1] })
  }

  return palette
}

/** Rec.709 luma (0..1) of the RGB triple starting at rgba[i*4]. */
function pixelLuma(rgba: Uint8ClampedArray, i: number): number {
  const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2]
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** 1st / 99th percentile of an image's luma distribution (auto contrast). */
function contrastRange(raw: Float32Array): [number, number] {
  const HIST = 256
  const hist = new Uint32Array(HIST)
  for (let i = 0; i < raw.length; i++) {
    hist[Math.min(HIST - 1, Math.max(0, Math.round(raw[i] * (HIST - 1))))]++
  }
  const total = raw.length
  const target = (pct: number) => Math.max(0, Math.round(total * pct))
  let lo = 0
  let acc = 0
  for (let h = 0; h < HIST; h++) {
    acc += hist[h]
    if (acc > target(0.01)) { lo = h / (HIST - 1); break }
  }
  let hi = 1
  acc = 0
  for (let h = HIST - 1; h >= 0; h--) {
    acc += hist[h]
    if (acc > target(0.01)) { hi = h / (HIST - 1); break }
  }
  if (hi - lo < 1 / (HIST - 1)) {
    // Nearly uniform image — fall back to the full 0..1 range.
    return [0, 1]
  }
  return [lo, hi]
}

/**
 * Assign every pixel to one of `palette.length` luminance bands.
 *
 * HueForge-style: a pixel's brightness decides how tall its column is, and
 * therefore which filament band its top surface ends in. The palette (sorted
 * darkest → lightest) provides the band colors in dark → light print order
 * when light pixels are the tallest; with `darkIsTall` the darkest image
 * areas stand the tallest instead and the band colors follow light → dark.
 */
export function mapToLuminanceBands(
  rgba: Uint8ClampedArray,
  palette: RGB[],
  width: number,
  height: number,
  darkIsTall: boolean,
): QuantizedImage {
  const pixelCount = width * height
  const n = Math.max(1, palette.length)
  const raw = new Float32Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) raw[i] = pixelLuma(rgba, i)
  const [lo, hi] = contrastRange(raw)
  const span = Math.max(1e-6, hi - lo)

  const indexMap = new Uint8Array(pixelCount)
  const luminance = new Float32Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    let x = Math.min(1, Math.max(0, (raw[i] - lo) / span))
    if (darkIsTall) x = 1 - x
    luminance[i] = x
    const band = Math.min(n - 1, Math.floor(x * n)) // 0 = printed first (bottom)
    // Bottom bands carry the darkest palette color unless dark is tallest.
    indexMap[i] = darkIsTall ? n - 1 - band : band
  }

  return { palette, indexMap, luminance, width, height }
}