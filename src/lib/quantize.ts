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

/** Squared perceptual-ish distance between two colors. */
function colorDistanceSq(a: RGB, b: RGB): number {
  const rmean = (a.r + b.r) / 2
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  // Redmean approximation of CIE76.
  return ((2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db)
}

/**
 * Map every pixel to its nearest palette color.
 * Returns a QuantizedImage with the palette sorted darkest → lightest.
 */
export function mapToPalette(rgba: Uint8ClampedArray, palette: RGB[], width: number, height: number): QuantizedImage {
  const pixelCount = width * height
  const indexMap = new Uint8Array(pixelCount)
  const paletteIndex = new Array(palette.length)
  for (let i = 0; i < palette.length; i++) paletteIndex[i] = i

  for (let i = 0; i < pixelCount; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2]
    let best = 0
    let bestDist = Infinity
    for (const idx of paletteIndex) {
      const c = palette[idx]
      const d = colorDistanceSq({ r, g, b }, c)
      if (d < bestDist) {
        bestDist = d
        best = idx
      }
    }
    indexMap[i] = best
  }

  return { palette, indexMap, width, height }
}