import type { QuantizedImage, RGB } from './types'
import { srgbToLab } from './deltae'

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

/** Squared RGB radius of a palette color's own neighbourhood (~12 units per channel). */
const NEIGHBOURHOOD = 3 * 12 * 12

/**
 * The filament palette of the brightness model, HueForge-style: a ladder of
 * the picture's own colors from its darkest to its lightest.
 *
 * In HueForge the filaments are stacked dark → light and a pixel's brightness
 * decides how many of them it shows through, so what matters is that the
 * rungs cover the picture's brightness range evenly: the darkest and the
 * lightest rung sit at 0.5 % / 99.5 % of the pixels (a stray pixel cannot
 * claim an end), the others at equal brightness steps between them. On each
 * rung the filament is the most common color of the picture at that
 * brightness — a real color, not the mean of a brightness slice (which turns
 * a red and a gray into mud) and not a rare outlier (a tiny red flag on a
 * blue ship). The color is only denoised by its close neighbourhood.
 * Returns `numColors` colors ordered dark → light.
 */
export function imagePalette(rgba: Uint8ClampedArray, numColors: number): RGB[] {
  const n = Math.max(1, numColors)
  const pixelCount = rgba.length / 4
  if (pixelCount === 0) return Array.from({ length: n }, () => ({ r: 0, g: 0, b: 0 }))

  const BINS = 32 * 32 * 32
  const count = new Uint32Array(BINS)
  const sum = new Float64Array(BINS * 3)
  for (let i = 0; i < pixelCount; i++) {
    const p = i * 4
    const r = rgba[p]!, g = rgba[p + 1]!, b = rgba[p + 2]!
    const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    count[bin]++
    sum[bin * 3] += r
    sum[bin * 3 + 1] += g
    sum[bin * 3 + 2] += b
  }
  const bins: number[] = []
  for (let bin = 0; bin < BINS; bin++) if (count[bin]) bins.push(bin)
  const mean = (bin: number, c: number) => sum[bin * 3 + c]! / count[bin]!
  const lumaOfBin = (bin: number) => 0.2126 * mean(bin, 0) + 0.7152 * mean(bin, 1) + 0.0722 * mean(bin, 2)

  // Brightness at a given share of the pixels, counted from the darkest.
  const byLuma = [...bins].sort((a, b) => lumaOfBin(a) - lumaOfBin(b))
  const atShare = (share: number) => {
    let acc = 0
    for (const bin of byLuma) {
      acc += count[bin]!
      if (acc >= pixelCount * share) return lumaOfBin(bin)
    }
    return lumaOfBin(byLuma[byLuma.length - 1]!)
  }
  const darkest = atShare(0.005)
  const lightest = atShare(0.995)
  const step = n > 1 ? (lightest - darkest) / (n - 1) : 0
  // Half a rung either side, never narrower than the 5-bit histogram itself.
  const half = Math.max(step / 2, 4)

  // Colors already on a rung: a rung prefers a color of its own, so a
  // brightness the picture skips borrows an *unused* color up to one rung
  // away instead of repeating the rung below; only when there is none does
  // it repeat the nearest color (a picture with fewer colors than rungs).
  const used = new Set<number>()
  const pick = (level: number, fresh: boolean): number => {
    let best = -1
    for (const bin of bins) {
      if ((fresh && used.has(bin)) || Math.abs(lumaOfBin(bin) - level) > half) continue
      if (best < 0 || count[bin]! > count[best]!) best = bin
    }
    if (best >= 0) return best
    for (const bin of bins) {
      const d = Math.abs(lumaOfBin(bin) - level)
      if (fresh && (used.has(bin) || d > 2 * half)) continue
      if (best < 0 || d < Math.abs(lumaOfBin(best) - level)) best = bin
    }
    return best
  }
  const rung = (level: number): RGB => {
    let best = pick(level, true)
    if (best < 0) best = pick(level, false) // fewer colors than rungs
    used.add(best)
    const s = [mean(best, 0), mean(best, 1), mean(best, 2)]
    let r = 0, g = 0, b = 0, w = 0
    for (const bin of bins) {
      const d = (mean(bin, 0) - s[0]!) ** 2 + (mean(bin, 1) - s[1]!) ** 2 + (mean(bin, 2) - s[2]!) ** 2
      if (d > NEIGHBOURHOOD) continue
      const k = count[bin]!
      r += mean(bin, 0) * k
      g += mean(bin, 1) * k
      b += mean(bin, 2) * k
      w += k
    }
    return { r: Math.round(r / w), g: Math.round(g / w), b: Math.round(b / w) }
  }
  if (n === 1) return [rung((darkest + lightest) / 2)]
  // The two ends first — they are the bottom and the top of the stack and
  // must be the picture's own darkest and lightest — then the rungs between.
  const palette: RGB[] = new Array(n)
  palette[0] = rung(darkest)
  palette[n - 1] = rung(lightest)
  for (let k = 1; k < n - 1; k++) palette[k] = rung(darkest + step * k)
  return palette
}

/** Smallest share of the picture a color needs to earn its own filament. */
const DISTINCT_MIN_SHARE = 0.015

/** Lab radius within which pixels count as «this color» for its share (ΔE76). */
const DISTINCT_RADIUS = 30

/**
 * The filament palette of the colors-first model: the picture's main color,
 * then repeatedly the color that differs most from the ones already chosen,
 * weighed by the cube root of its share — among the colors that cover at
 * least ~1.5 % of the picture.
 *
 * Here every pixel takes the filament nearest to its own color, so a red suit
 * on a teal sky can have a red filament without reddening the sky — but only
 * if the palette offers one. Median cut (by area) spent all four colors on the
 * sky and the ground and dropped the suit; picking by difference keeps it.
 *
 * Candidates are the cells of a 4-bit color histogram. A color's share counts
 * every pixel within ΔE 30 of it, so a shaded surface (a suit from deep red to
 * pink) adds up to one color instead of crumbling into cells too small to
 * count. The share floor keeps a speck (a flag, a highlight) from taking a
 * spool; if there are not enough such colors, the floor is lowered to fill
 * every slot. Each pick is denoised by its close neighbourhood. Returns
 * `numColors` colors, unsorted.
 */
export function distinctPalette(rgba: Uint8ClampedArray, numColors: number): RGB[] {
  const n = Math.max(1, numColors)
  const pixelCount = rgba.length / 4
  if (pixelCount === 0) return Array.from({ length: n }, () => ({ r: 0, g: 0, b: 0 }))

  const CELLS = 16 * 16 * 16
  const count = new Uint32Array(CELLS)
  const sum = new Float64Array(CELLS * 3)
  for (let i = 0; i < pixelCount; i++) {
    const p = i * 4
    const r = rgba[p]!, g = rgba[p + 1]!, b = rgba[p + 2]!
    const cell = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    count[cell]++
    sum[cell * 3] += r
    sum[cell * 3 + 1] += g
    sum[cell * 3 + 2] += b
  }
  const cells: number[] = []
  for (let c = 0; c < CELLS; c++) if (count[c]) cells.push(c)
  const points = cells.map((c) => [sum[c * 3]! / count[c]!, sum[c * 3 + 1]! / count[c]!, sum[c * 3 + 2]! / count[c]!])
  // «How different» is measured in Lab, the way the eye sees it: a saturated
  // red suit stands far from a dark visor (ΔE ≈ 75) while green grass sits
  // close to a teal sky (ΔE ≈ 42) — in RGB the big green field outvoted the
  // suit.
  const labs = points.map((p) => srgbToLab(p[0]!, p[1]!, p[2]!))
  const labDist2 = (p: number[], q: number[]) => (p[0]! - q[0]!) ** 2 + (p[1]! - q[1]!) ** 2 + (p[2]! - q[2]!) ** 2
  const radius2 = DISTINCT_RADIUS * DISTINCT_RADIUS
  const share = labs.map((l) => {
    let s = 0
    for (let k = 0; k < cells.length; k++) if (labDist2(l, labs[k]!) <= radius2) s += count[cells[k]!]!
    return s / pixelCount
  })

  // No forced darkest / lightest ends here: every pixel takes its nearest
  // filament, so a 1 % white glare would only steal a slot from the subject.
  // Start from the color that covers the most of the picture.
  let first = 0
  for (let j = 1; j < cells.length; j++) if (share[j]! > share[first]!) first = j
  const picked: number[] = [first]
  const nearest = labs.map((l) => labDist2(l, labs[first]!))
  for (let floor = DISTINCT_MIN_SHARE; picked.length < n; ) {
    let best = -1
    let bestScore = 0
    for (let j = 0; j < cells.length; j++) {
      if (share[j]! < floor || nearest[j]! <= 0) continue
      // Linear distance × cube root of the share: a distinct color needs only a
      // modest area to earn a spool, while a speck never outweighs a subject.
      const score = Math.sqrt(nearest[j]!) * Math.cbrt(share[j]!)
      if (score > bestScore) {
        bestScore = score
        best = j
      }
    }
    if (best < 0) {
      if (floor === 0) break // fewer distinct colors than slots
      floor = floor > 0.002 ? floor / 4 : 0
      continue
    }
    picked.push(best)
    for (let j = 0; j < cells.length; j++) nearest[j] = Math.min(nearest[j]!, labDist2(labs[j]!, labs[best]!))
  }

  // Each pick, denoised: the pixel-weighted mean of the cells close to it.
  const palette = picked.map((j) => {
    let r = 0, g = 0, b = 0, w = 0
    for (let k = 0; k < cells.length; k++) {
      if (labDist2(labs[k]!, labs[j]!) > 8 * 8) continue
      const c = count[cells[k]!]!
      r += points[k]![0]! * c
      g += points[k]![1]! * c
      b += points[k]![2]! * c
      w += c
    }
    return { r: Math.round(r / w), g: Math.round(g / w), b: Math.round(b / w) }
  })
  while (palette.length < n) palette.push({ ...palette[palette.length - 1]! })
  return palette
}

/** Rec.709 luma (0..1) of the RGB triple starting at rgba[i*4]. */
function pixelLuma(rgba: Uint8ClampedArray, i: number): number {
  const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2]
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/**
 * Assign every pixel to one of `numColors` luminance bands and derive the
 * band colors from the image itself.
 *
 * HueForge-style: a pixel's brightness decides how tall its column is, and
 * therefore which filament band its top surface ends in. Band 0 covers the
 * lowest relief slice and is printed first (bottom); its pixels are the
 * darkest (or, with `darkIsTall`, the brightest — the relief is inverted).
 *
 * The filaments are the picture's own colors (`imagePalette`), ordered
 * dark → light. Each band boundary sits halfway between the brightness of two
 * neighbouring colors, so a pixel's brightness picks the filament nearest to
 * it and its relief stays inside that filament's slice. A large uniform
 * background therefore takes one band, not several near-identical ones, and
 * details of different hues are not averaged into one mixed color.
 *
 * A depth relief (no brightness to cut by) keeps equal-population bands —
 * each takes the next slice of ~1/N of the pixels — colored by the mean of
 * the pixels in the slice; empty bands inherit the nearest populated color.
 */
/** Smallest connected same-band region kept as-is (3×3 cells). */
export const MIN_REGION_CELLS = 9

/** A connected component of same-band pixels (4-connectivity). */
interface Component {
  cells: number[]
  color: number
}

/**
 * All connected same-label components (4-connectivity), any size.
 * Single allocation-free flood fill reused for cleanup and neighbors.
 */
export function components(labels: Uint8Array, width: number, height: number): Component[] {
  const total = width * height
  const visited = new Uint8Array(total)
  const stack: number[] = []
  const out: Component[] = []

  for (let start = 0; start < total; start++) {
    if (visited[start]) continue
    const color = labels[start]
    const cells: number[] = []
    stack.length = 0
    stack.push(start)
    visited[start] = 1
    while (stack.length > 0) {
      const p = stack.pop()!
      cells.push(p)
      const px = p % width
      if (px > 0 && !visited[p - 1] && labels[p - 1] === color) {
        visited[p - 1] = 1
        stack.push(p - 1)
      }
      if (px < width - 1 && !visited[p + 1] && labels[p + 1] === color) {
        visited[p + 1] = 1
        stack.push(p + 1)
      }
      if (p >= width && !visited[p - width] && labels[p - width] === color) {
        visited[p - width] = 1
        stack.push(p - width)
      }
      if (p < total - width && !visited[p + width] && labels[p + width] === color) {
        visited[p + width] = 1
        stack.push(p + width)
      }
    }
    out.push({ cells, color })
  }
  return out
}

/**
 * Equal-population band labels for a relief array (0 = bottom band).
 *
 * Pixels that share a histogram bin are ranked in raster order, so a plateau
 * that straddles a band boundary is cut into horizontal stripes. That is the
 * historical behaviour of the brightness relief and stays byte-identical. With
 * `tieAware` every pixel of a bin takes the band of the bin's first rank, so a
 * plateau is one band — a depth map's flat background stays whole, at the base.
 */
function bandLabels(
  x: Float32Array,
  n: number,
  darkIsTall: boolean,
  pixelCount: number,
  tieAware = false,
): Uint8Array {
  const HIST = 256
  const hist = new Uint32Array(HIST)
  for (let i = 0; i < pixelCount; i++) {
    hist[Math.min(HIST - 1, Math.round(x[i] * (HIST - 1)))]++
  }
  const cum = new Uint32Array(HIST + 1)
  for (let h = 0; h < HIST; h++) cum[h + 1] = cum[h] + hist[h]
  const indexMap = new Uint8Array(pixelCount)
  const rankInBin = new Uint32Array(HIST)
  for (let i = 0; i < pixelCount; i++) {
    const bin = Math.min(HIST - 1, Math.round(x[i] * (HIST - 1)))
    const rank = tieAware ? cum[bin] : cum[bin] + rankInBin[bin]++
    const band = Math.min(n - 1, Math.floor((rank * n) / pixelCount))
    indexMap[i] = darkIsTall ? n - 1 - band : band
  }
  return indexMap
}

/**
 * Floyd–Steinberg error diffusion over the relief signal: band boundaries
 * become smooth dithered gradients instead of hard steps — the HueForge
 * look. Quantization levels are the clean bands' mean relief values, so a
 * pixel's error is how far it sits from the band it lands in; `strength`
 * scales the propagated error (0 = off, 1 = classic FS). Serpentine scan
 * suppresses directional artifacts.
 *
 * Only labels change. Palette colors (physical filaments) and band tops
 * (heights / swap schedule) stay from the clean pass — dithering mixes the
 * existing bands spatially, it does not invent new ones.
 */
function ditherLabels(
  relief: Float32Array,
  cleanLabels: Uint8Array,
  width: number,
  height: number,
  n: number,
  darkIsTall: boolean,
  strength: number,
): Uint8Array {
  // Work in relief-band space (0 = lowest relief): slice labels run opposite
  // to relief values when darkIsTall, so flip at the edges and diffusing
  // stays direction-agnostic.
  const toReliefBand = (s: number) => (darkIsTall ? n - 1 - s : s)
  const toSlice = (b: number) => (darkIsTall ? n - 1 - b : b)

  // Clean-pass value range and mean (reconstruction level) per band. Bands
  // are contiguous slices of the sorted relief, so their ranges are ordered.
  const min = new Float64Array(n).fill(Infinity)
  const max = new Float64Array(n).fill(-Infinity)
  const sum = new Float64Array(n)
  const count = new Uint32Array(n)
  for (let i = 0; i < relief.length; i++) {
    const b = toReliefBand(cleanLabels[i])
    const v = relief[i]
    if (v < min[b]) min[b] = v
    if (v > max[b]) max[b] = v
    sum[b] += v
    count[b]++
  }
  const level = new Float64Array(n)
  for (let b = 0; b < n; b++) level[b] = count[b] ? sum[b] / count[b] : 0

  const pick = (v: number): number => {
    let b = 0
    while (b < n - 1 && v > max[b]) b++
    return b
  }

  const out = new Uint8Array(relief.length)
  const values = Float32Array.from(relief) // accumulated error lives here
  for (let y = 0; y < height; y++) {
    const ltr = y % 2 === 0
    for (let xi = 0; xi < width; xi++) {
      const x = ltr ? xi : width - 1 - xi
      const i = y * width + x
      const v = Math.min(1, Math.max(0, values[i]))
      const b = pick(v)
      out[i] = toSlice(b)
      const e = (v - level[b]) * strength
      if (e === 0) continue
      const dx = ltr ? 1 : -1
      const xr = x + dx
      const yn = y + 1
      if (xr >= 0 && xr < width) values[i - x + xr] += (e * 7) / 16
      if (yn < height) {
        const xl = x - dx
        if (xl >= 0 && xl < width) values[yn * width + xl] += (e * 3) / 16
        values[yn * width + x] += (e * 5) / 16
        if (xr >= 0 && xr < width) values[yn * width + xr] += (e * 1) / 16
      }
    }
  }
  return out
}

/**
 * Band boundaries from a dark → light palette (fractions of the relief height,
 * 0..1): each boundary sits halfway between the relief positions of two
 * neighbouring colors, so a pixel lands in the band of the filament closest
 * to it in brightness. `lo` / `span` are the same auto-contrast range the
 * pixels were normalized with.
 */
function paletteBandTops(palette: RGB[], lo: number, span: number, darkIsTall: boolean): number[] {
  const n = palette.length
  // Slice s (0 = bottom) holds palette slot k = s, or n-1-s with darkIsTall.
  const pos = Array.from({ length: n }, (_, s) => {
    const v = Math.min(1, Math.max(0, (lumaOf(palette[darkIsTall ? n - 1 - s : s]!) - lo) / span))
    return darkIsTall ? 1 - v : v
  })
  const tops: number[] = new Array(n)
  for (let s = 0; s < n - 1; s++) tops[s] = (pos[s]! + pos[s + 1]!) / 2
  tops[n - 1] = 1
  return tops
}

/** Band labels for a relief array cut at fixed band tops (see `paletteBandTops`). */
function labelsByTops(x: Float32Array, tops: number[], darkIsTall: boolean, pixelCount: number): Uint8Array {
  const n = tops.length
  const indexMap = new Uint8Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    let band = 0
    while (band < n - 1 && x[i]! > tops[band]!) band++
    indexMap[i] = darkIsTall ? n - 1 - band : band
  }
  return indexMap
}

/** Equal-population band boundaries (fractions of the relief height, 0..1). */
function bandTopsFrom(x: Float32Array, n: number, pixelCount: number): number[] {
  const HIST = 256
  const hist = new Uint32Array(HIST)
  for (let i = 0; i < pixelCount; i++) {
    hist[Math.min(HIST - 1, Math.round(x[i] * (HIST - 1)))]++
  }
  const cum = new Uint32Array(HIST + 1)
  for (let h = 0; h < HIST; h++) cum[h + 1] = cum[h] + hist[h]
  const bandTops: number[] = new Array(n)
  for (let b = 0; b < n - 1; b++) {
    const need = ((b + 1) * pixelCount) / n
    let h = 0
    while (h < HIST && cum[h] < need) h++
    bandTops[b] = Math.min(1, h / HIST)
  }
  bandTops[n - 1] = 1
  return bandTops
}

/**
 * Different-band neighbors of a component with their relief values.
 * (4-neighbors with a different label sit outside the component — same-label
 * adjacency is exactly what defines it.)
 */
function outsideNeighbors(
  comp: Component,
  labels: Uint8Array,
  x: Float32Array,
  width: number,
  height: number,
): { colors: number[]; values: number[] } {
  const total = width * height
  const colors: number[] = []
  const values: number[] = []
  for (const p of comp.cells) {
    const px = p % width
    if (px > 0 && labels[p - 1] !== comp.color) { colors.push(labels[p - 1]); values.push(x[p - 1]) }
    if (px < width - 1 && labels[p + 1] !== comp.color) { colors.push(labels[p + 1]); values.push(x[p + 1]) }
    if (p >= width && labels[p - width] !== comp.color) { colors.push(labels[p - width]); values.push(x[p - width]) }
    if (p < total - width && labels[p + width] !== comp.color) { colors.push(labels[p + width]); values.push(x[p + width]) }
  }
  return { colors, values }
}

/**
 * Merge fragile isolated regions (< `minArea` cells, 4-connectivity) into
 * their surroundings so specks never reach the mesh.
 *
 * A component that touches a single different band takes that band's mean
 * relief value — it joins the ground it grows out of. A component straddling
 * a color boundary takes the majority band's mean, so the boundary keeps its
 * shape instead of blurring into a mid value. Components with no outside
 * neighbors (whole-image single band) pass through untouched.
 *
 * Returns a new relief array; labels and colors are re-derived from it.
 */
export function removeIsolatedRegions(
  x: Float32Array,
  labels: Uint8Array,
  width: number,
  height: number,
  minArea: number = MIN_REGION_CELLS,
): Float32Array {
  const out = new Float32Array(x)

  for (const comp of components(labels, width, height)) {
    if (comp.cells.length >= minArea) continue
    const { colors, values } = outsideNeighbors(comp, labels, x, width, height)
    if (colors.length === 0) continue

    // Majority vote over the touching bands, ties broken by the closer band
    // in value, then by the lower band id (deterministic).
    const tally = new Map<number, { count: number; sum: number }>()
    for (let i = 0; i < colors.length; i++) {
      const t = tally.get(colors[i]) ?? { count: 0, sum: 0 }
      t.count++
      t.sum += values[i]
      tally.set(colors[i], t)
    }
    let bestColor = colors[0]
    let best = tally.get(bestColor)!
    for (const [color, t] of tally) {
      if (
        t.count > best.count ||
        (t.count === best.count && Math.abs(t.sum / t.count - x[comp.cells[0]]!) < Math.abs(best.sum / best.count - x[comp.cells[0]]!))
      ) {
        bestColor = color
        best = t
      }
    }
    const mean = best.sum / best.count
    for (const p of comp.cells) out[p] = mean
  }

  return out
}

/**
 * Relief tone curve — how image brightness becomes relief height.
 *
 * This is the tone stage of the Filapaint / HueForge Standard relief model:
 * the print is a solid base plate plus a relief whose *thickness* follows the
 * picture, and these two knobs shape that tonal ramp (the free tool at
 * cxwl.org exposes them as «Contrast» and «Power Deepening»). Both act on the
 * oriented relief position 0..1 (0 = base, 1 = tallest), *before* the band
 * ranking, so the pixel → filament assignment is untouched: contrast and
 * power move heights only, never which color a pixel prints in. Band tops
 * (color-change Z heights) are read off the same values, so a pixel's surface
 * always stays inside the band that owns it.
 */
export interface ToneCurve {
  /**
   * Contrast around mid-relief, 0..3 (1 = the picture's own tones). Below 1
   * the relief flattens toward the middle of the range, above 1 the tones
   * spread outward — deeper shadows against higher lights. The curve is
   * strictly monotone and pins 0 and 1: a linear contrast would saturate a
   * whole slice of tones onto base or top, and those pixels would fall outside
   * their own filament's slice (see applyTone).
   */
  contrast?: number
  /**
   * Power (detail deepening), 0.2..3 (1 = unchanged). Above 1 mid-tones sink
   * toward the base while the peaks stay high — a deeper, more sculpted
   * relief; below 1 mid-tones rise again and the relief flattens out.
   */
  power?: number
}

/** Bounds of the tone knobs, shared by the UI, the project file and the worker. */
export const TONE_CONTRAST_MIN = 0
export const TONE_CONTRAST_MAX = 3
export const TONE_POWER_MIN = 0.2
export const TONE_POWER_MAX = 3

/**
 * Apply the relief tone curve to one oriented relief position (0..1).
 *
 * Contrast first, then power — the order the free Filapaint tool applies its
 * «Contrast» and «Power Deepening» inputs. Missing, non-finite or out-of-range
 * values fall back to the identity, so an old project or a stray input can
 * never distort the relief.
 */
export function applyTone(v: number, tone?: ToneCurve): number {
  let t = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
  const rawContrast = tone?.contrast
  const k = Number.isFinite(rawContrast)
    ? Math.min(TONE_CONTRAST_MAX, Math.max(TONE_CONTRAST_MIN, rawContrast!))
    : 1
  if (k !== 1) {
    // Smooth two-piece contrast: each half of the range is raised to k, so
    // k > 1 pushes tones away from the middle (k = 2 sends 0.25 → 0.125 and
    // 0.75 → 0.875) and k < 1 pulls them back in. Both ends stay pinned to 0
    // and 1 — no saturation — which is what keeps a pixel inside the color
    // band its own tone was assigned to.
    t = t < 0.5 ? 0.5 * Math.pow(2 * t, k) : 1 - 0.5 * Math.pow(2 * (1 - t), k)
  }
  const rawPower = tone?.power
  const p = Number.isFinite(rawPower) ? Math.min(TONE_POWER_MAX, Math.max(TONE_POWER_MIN, rawPower!)) : 1
  if (p !== 1) t = Math.pow(t, p)
  return t
}

export function mapToLuminanceBands(
  rgba: Uint8ClampedArray,
  numColors: number,
  width: number,
  height: number,
  darkIsTall: boolean,
  /** Floyd–Steinberg strength 0..1 (0 = off, the default). */
  dither = 0,
  /** Relief tone curve (contrast + power); omitted = the picture's own tones. */
  tone?: ToneCurve,
  /**
   * Pixels the band COLORS are averaged from, when they should not be the ones
   * that decided the boundaries. The boundaries must follow the picture's
   * detail, while an average color should not be dragged by the noise sitting
   * around it — so the caller may pass a more smoothed image here. Omitted (or
   * identical) = average the same pixels, the historical behaviour.
   */
  colorSource?: Uint8ClampedArray,
  /**
   * Smallest fraction of the usable height any color band may occupy (see
   * `enforceBandFloor`). 0 (default) leaves the band tops exactly as the tone
   * curve produced them — the historical behaviour.
   */
  minBandFrac = 0,
  /**
   * Relief position per pixel from somewhere other than the picture's
   * brightness (a depth map): `width × height` values in 0..1, 1 = tallest.
   * The field already says which end stands tall, so `darkIsTall` is ignored
   * and the palette index equals the height slice (base → top) — it is NOT
   * sorted by brightness. Omitted = the brightness relief, byte-identical to
   * before.
   */
  reliefField?: Float32Array,
): QuantizedImage {
  const pixelCount = width * height
  const n = Math.max(1, numColors)
  if (reliefField) {
    if (reliefField.length !== pixelCount) throw new Error('Relief field does not match the image size')
    darkIsTall = false
  }
  // A depth relief has real plateaus (a flat background, a flat foreground): keep
  // each one in a single band instead of striping it (see `bandLabels`).
  const tieAware = !!reliefField
  const raw = new Float32Array(pixelCount)
  if (!reliefField) for (let i = 0; i < pixelCount; i++) raw[i] = pixelLuma(rgba, i)
  // Height follows the picture's own brightness one to one, as in HueForge
  // Standard: luma 0 sits on the base, luma 1 at the full relief. Measured on a
  // HueForge STL against its source picture the height is linear in luma
  // (r = 0.92) with no auto-contrast stretch — a stretch, and on top of it an
  // S-curve, is what turned a calm 2 mm painting into blocks and cliffs.
  // Shaping the relief is the tone curve's job (the style presets).
  const lo = 0
  const span = 1

  // Per-pixel relief position x (0 = base, 1 = tallest). Deliberately *before*
  // the tone curve: band assignment, speck cleanup, band tops and dithering
  // all read the untouched relief, so contrast and power cannot move a color
  // boundary by even one pixel. The curve is applied to the heights and the
  // band tops together at the end (see `applyToneToRelief`).
  const x = new Float32Array(pixelCount)
  if (reliefField) {
    for (let i = 0; i < pixelCount; i++) {
      const v = reliefField[i]!
      x[i] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
    }
  } else {
    for (let i = 0; i < pixelCount; i++) {
      let v = Math.min(1, Math.max(0, (raw[i] - lo) / span))
      if (darkIsTall) v = 1 - v
      x[i] = v
    }
  }

  // Automatically flatten fragile isolated regions (same-band specks under
  // 3×3 cells) into their surroundings, then re-derive bands and colors from
  // the cleaned relief — a pixel's color stays a pure function of its height.
  // Images too small to contain a 3×3 neighborhood are left untouched: there
  // every pixel is a "speck" and the relief itself is legitimate detail.
  //
  // Flattening a boundary-straddling speck can still leave sub-area fragments
  // on the re-derived bands, so the pass repeats until no specks remain (or a
  // fixed guard limit — every pass strictly reduces sub-area cell count).
  // The brightness relief takes its filaments from the picture's own colors
  // ordered dark → light, with each band boundary halfway between
  // two neighbouring colors' brightness. Equal-population slices averaged into
  // one color each let a large dark background claim several near-identical
  // blacks while a red and a white detail shared one band and blended into
  // pink. A depth relief has no brightness to cut by and keeps the
  // equal-population bands.
  const colors = colorSource && colorSource.length === rgba.length ? colorSource : rgba
  const filaments = reliefField ? undefined : imagePalette(colors, n).sort((a, b) => lumaOf(a) - lumaOf(b))
  const paletteTops = filaments ? paletteBandTops(filaments, lo, span, darkIsTall) : undefined
  const label = (field: Float32Array) =>
    paletteTops
      ? labelsByTops(field, paletteTops, darkIsTall, pixelCount)
      : bandLabels(field, n, darkIsTall, pixelCount, tieAware)

  const canClean = width >= 3 && height >= 3
  let relief: Float32Array = x
  if (canClean) {
    for (let pass = 0; pass < 8; pass++) {
      const labels0 = label(relief)
      const cleaned = removeIsolatedRegions(relief, labels0, width, height, MIN_REGION_CELLS)
      const labels1 = label(cleaned)
      const remaining = components(labels1, width, height).filter((c) => c.cells.length < MIN_REGION_CELLS).length
      relief = cleaned
      if (remaining === 0) break
    }
  }

  // Final bands on the cleaned relief: brightness cut at the palette's
  // boundaries, or (depth relief) by rank — each band takes the next slice of
  // ⌊count/n⌋ or ⌈count/n⌉ pixels.
  const indexMap = label(relief)
  const bandTops = paletteTops ? [...paletteTops] : bandTopsFrom(relief, n, pixelCount)
  const palette: RGB[] = filaments ?? depthBandColors(colors, indexMap, n, darkIsTall, pixelCount)

  // Dithering is the last step: it only re-labels pixels near the band
  // boundaries, keeping the filament colors and band tops from above. When it
  // runs, the pre-dither labels are kept alongside: they are the honest input
  // for printability's fragile-speck check, because FS dots are intentional
  // texture, not specks.
  const clampedDither = Math.min(1, Math.max(0, dither))
  const finalIndexMap = clampedDither > 0
    ? ditherLabels(relief, indexMap, width, height, n, darkIsTall, clampedDither)
    : indexMap

  // Tone last, on both sides of the same monotone map: the heights and the
  // band tops the swap heights are read from. Because the map preserves order,
  // every surface stays exactly where it was relative to its own band — the
  // relief deepens or flattens, while the color regions keep their pixels.
  const { luminance, tops } = applyToneToRelief(relief, bandTops, tone, minBandFrac)

  const result: QuantizedImage = { palette, indexMap: finalIndexMap, luminance, bandTops: tops, width, height }
  if (finalIndexMap !== indexMap) result.cleanIndexMap = indexMap
  return result
}

/**
 * Depth-relief band colors: the mean color of the pixels in each slice (dark →
 * light). The pixels averaged may come from a cleaner image (`colorSource`),
 * so a noisy boundary does not smear mud into the filament colors.
 */
function depthBandColors(
  colors: Uint8ClampedArray,
  indexMap: Uint8Array,
  n: number,
  darkIsTall: boolean,
  pixelCount: number,
): RGB[] {
  const bandSums = Array.from({ length: n }, () => [0, 0, 0] as [number, number, number])
  const bandCounts = new Uint32Array(n)
  for (let i = 0; i < pixelCount; i++) {
    const slice = darkIsTall ? n - 1 - indexMap[i] : indexMap[i]
    const p = i * 4
    bandSums[slice][0] += colors[p]
    bandSums[slice][1] += colors[p + 1]
    bandSums[slice][2] += colors[p + 2]
    bandCounts[slice]++
  }

  // Palette index k (dark → light) draws its color from the slice that
  // matches its position in the depth mode.
  const palette: RGB[] = new Array(n)
  for (let k = 0; k < n; k++) {
    const b = darkIsTall ? n - 1 - k : k
    if (bandCounts[b] === 0) continue
    const s = bandSums[b]
    const c = bandCounts[b]
    palette[k] = { r: Math.round(s[0] / c), g: Math.round(s[1] / c), b: Math.round(s[2] / c) }
  }
  // Empty palette slots (fewer pixels than colors) inherit the color of the
  // nearest populated slot, preferring the darker side.
  for (let k = 0; k < n; k++) {
    if (palette[k]) continue
    for (let d = 1; d < n; d++) {
      if (k - d >= 0 && palette[k - d]) { palette[k] = palette[k - d]; break }
      if (k + d < n && palette[k + d]) { palette[k] = palette[k + d]; break }
    }
    palette[k] ??= { r: 0, g: 0, b: 0 }
  }
  return palette
}

/**
 * Apply the relief tone curve to the heights and to the band tops at once.
 *
 * Both sides are transformed with the same monotone map, so a pixel that sat
 * inside band `b` still sits inside it: the physical color-change heights move
 * with the relief instead of being left behind. A neutral (or absent) curve
 * returns the inputs untouched — no copy, no rounding, byte-identical output.
 */
function applyToneToRelief(
  relief: Float32Array,
  bandTops: number[],
  tone?: ToneCurve,
  minBandFrac = 0,
): { luminance: Float32Array; tops: number[] } {
  const neutral =
    tone === undefined ||
    ((tone.contrast === undefined || !Number.isFinite(tone.contrast) || tone.contrast === 1) &&
      (tone.power === undefined || !Number.isFinite(tone.power) || tone.power === 1))
  if (neutral) return enforceBandFloor(relief, bandTops, minBandFrac)
  const luminance = new Float32Array(relief.length)
  for (let i = 0; i < relief.length; i++) luminance[i] = applyTone(relief[i]!, tone)
  return enforceBandFloor(luminance, bandTops.map((t) => applyTone(t, tone)), minBandFrac)
}

/**
 * Apply the printable band floor to a quantized image, returning the input
 * untouched (same object) when nothing was thin — the neutral path stays
 * byte-identical.
 */
export function withBandFloor(q: QuantizedImage, minFrac: number): QuantizedImage {
  const floored = enforceBandFloor(q.luminance, q.bandTops, minFrac)
  if (floored.luminance === q.luminance && floored.tops === q.bandTops) return q
  return { ...q, luminance: floored.luminance, bandTops: floored.tops }
}

/**
 * Give every color band at least `minFrac` of the usable height.
 *
 * The tone curve reshapes the relief *and* the band tops with the same
 * monotone map, so a strong preset (the shipped «deep relief» is contrast 130 %
 * / power 250 % on a typical photo) can push the bottom bands down to one
 * layer. Such a band is invisible in the print: the preview models filaments
 * as translucent sheets, so a one-layer sheet shows the color below it, and the
 * picture's shadows — exactly the area a deep-relief look wants to keep — melt
 * into a single muddy mass of a neighboring color.
 *
 * The repair is a second monotone map, built from the band tops themselves:
 * each top is raised to at least its predecessor plus the floor, and every
 * pixel is remapped through the same piecewise-linear curve. Because the curve
 * is monotone and maps each band's own range into its own (raised) slice, a
 * pixel can never leave the color band it was assigned — the swap heights move
 * with the surface, which is the invariant the tone curve already promises.
 *
 * Returns the inputs untouched (same references) when no band is thin, so the
 * neutral path stays byte-identical to the pre-floor geometry.
 */
export function enforceBandFloor(
  luminance: Float32Array,
  bandTops: number[],
  minFrac: number,
): { luminance: Float32Array; tops: number[] } {
  const n = bandTops.length
  if (!(minFrac > 0) || n === 0 || luminance.length === 0) return { luminance, tops: bandTops }
  const floor = Math.min(minFrac, 1 / n)

  const src = bandTops.map((t) => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 1))
  const raised: number[] = new Array(n)
  let changed = false
  let prev = 0
  for (let b = 0; b < n; b++) {
    // The top band always ends at 1: the model's maximum height is the input,
    // and the floor may only redistribute heights below it.
    const ideal = b === n - 1 ? 1 : src[b]!
    const top = Math.min(1, Math.max(ideal, prev + floor))
    if (top > ideal + 1e-9) changed = true
    raised[b] = top
    prev = top
  }
  if (!changed) return { luminance, tops: bandTops }

  const mapValue = (v: number): number => {
    let band = 0
    while (band < n - 1 && v > src[band]!) band++
    const loSrc = band === 0 ? 0 : src[band - 1]!
    const hiSrc = Math.max(loSrc + 1e-9, src[band]!)
    const loDst = band === 0 ? 0 : raised[band - 1]!
    const hiDst = raised[band]!
    const local = Math.min(1, Math.max(0, (v - loSrc) / (hiSrc - loSrc)))
    return loDst + (hiDst - loDst) * local
  }

  const out = new Float32Array(luminance.length)
  for (let i = 0; i < luminance.length; i++) out[i] = mapValue(luminance[i]!)
  return { luminance: out, tops: raised }
}
// ---- Catalog palette quantization (HueForge-style: nearest filament color) ----

/**
 * Merge connected components smaller than `minArea` into the most common
 * neighbor label (4-connectivity), like the luminance path merges speckles.
 * Repeats until no small components remain or a fixed guard limit is hit.
 * Returns a new label array; the input is never mutated.
 */
function cleanupSmallRegions(labels: Uint8Array, width: number, height: number, minArea = MIN_REGION_CELLS): Uint8Array {
  let out = labels
  for (let pass = 0; pass < 8; pass++) {
    const comps = components(out, width, height)
    const small = comps.filter((c) => c.cells.length < minArea)
    if (small.length === 0) break
    out = out.slice()
    for (const comp of small) {
      const counts = new Map<number, number>()
      for (const p of comp.cells) {
        const px = p % width
        if (px > 0 && out[p - 1] !== comp.color) counts.set(out[p - 1], (counts.get(out[p - 1]) ?? 0) + 1)
        if (px < width - 1 && out[p + 1] !== comp.color) counts.set(out[p + 1], (counts.get(out[p + 1]) ?? 0) + 1)
        if (p >= width && out[p - width] !== comp.color) counts.set(out[p - width], (counts.get(out[p - width]) ?? 0) + 1)
        if (p < width * height - width && out[p + width] !== comp.color) counts.set(out[p + width], (counts.get(out[p + width]) ?? 0) + 1)
      }
      let best = -1
      let bestCount = 0
      for (const [label, count] of counts) {
        if (count > bestCount) {
          bestCount = count
          best = label
        }
      }
      if (best >= 0) for (const p of comp.cells) out[p] = best
    }
  }
  return out
}

/**
 * Floyd–Steinberg error diffusion over RGB against the given spool colors:
 * each pixel picks the nearest spool (redmean), and the channel-wise color
 * error — scaled by `strength` — is diffused to the neighbors, so hard color
 * transitions become smooth dithered gradients. Serpentine scan, like the
 * luminance dither. `strength` 0..1; 0 leaves the labels untouched.
 */
function ditherColors(
  rgba: Uint8ClampedArray,
  cleanLabels: Uint8Array,
  spools: RGB[],
  width: number,
  height: number,
  strength: number,
): Uint8Array {
  const n = spools.length
  const total = width * height
  const out = cleanLabels.slice()
  const err = new Float32Array(total * 3)
  const pick = (r: number, g: number, b: number): number => {
    let best = 0
    let bestD = Infinity
    for (let s = 0; s < n; s++) {
      const c = spools[s]
      const dr = r - c.r
      const dg = g - c.g
      const db = b - c.b
      const rm = (r + c.r) / 2
      const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best
  }
  for (let y = 0; y < height; y++) {
    const ltr = y % 2 === 0
    for (let xi = 0; xi < width; xi++) {
      const x = ltr ? xi : width - 1 - xi
      const i = y * width + x
      const p = i * 4
      const er = err[i * 3]
      const eg = err[i * 3 + 1]
      const eb = err[i * 3 + 2]
      const r = Math.min(255, Math.max(0, rgba[p] + er))
      const g = Math.min(255, Math.max(0, rgba[p + 1] + eg))
      const b = Math.min(255, Math.max(0, rgba[p + 2] + eb))
      const s = pick(r, g, b)
      out[i] = s
      const eR = (r - spools[s].r) * strength
      const eG = (g - spools[s].g) * strength
      const eB = (b - spools[s].b) * strength
      if (eR === 0 && eG === 0 && eB === 0) continue
      const dx = ltr ? 1 : -1
      const xr = x + dx
      const yn = y + 1
      if (xr >= 0 && xr < width) {
        const ni = i - x + xr
        err[ni * 3] += (eR * 7) / 16
        err[ni * 3 + 1] += (eG * 7) / 16
        err[ni * 3 + 2] += (eB * 7) / 16
      }
      if (yn < height) {
        const xl = x - dx
        if (xl >= 0 && xl < width) {
          const ni = yn * width + xl
          err[ni * 3] += (eR * 3) / 16
          err[ni * 3 + 1] += (eG * 3) / 16
          err[ni * 3 + 2] += (eB * 3) / 16
        }
        const ni = yn * width + x
        err[ni * 3] += (eR * 5) / 16
        err[ni * 3 + 1] += (eG * 5) / 16
        err[ni * 3 + 2] += (eB * 5) / 16
        if (xr >= 0 && xr < width) {
          const ni = yn * width + xr
          err[ni * 3] += (eR * 1) / 16
          err[ni * 3 + 1] += (eG * 1) / 16
          err[ni * 3 + 2] += (eB * 1) / 16
        }
      }
    }
  }
  return out
}

/**
 * HueForge-style palette quantization against a fixed set of filament colors:
 * every pixel is assigned the nearest spool color (redmean distance), so the
 * printed picture is made of exactly the chosen spools — no auto-derived
 * colors, no «it printed a different shade» surprises.
 *
 * The caller passes the spools already sorted dark → light (slot order).
 * Bands are equal-thickness (each color owns 1/N of the usable height), tiny
 * same-color speckles are merged into their surroundings, and optional
 * Floyd–Steinberg dithering smooths hard color transitions. The pre-dither
 * labels are kept as `cleanIndexMap` so printability judges honest geometry.
 */
/** Rec.709 luma (0..1) of a palette color. */
function lumaOf(c: RGB): number {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255
}

/**
 * Palette sizing from the picture's own COLORS (median cut), instead of from
 * its brightness bands.
 *
 * The luminance model answers «how tall is this pixel?» with the picture's
 * brightness, and the filament follows from that height — which is what makes
 * it the HueForge Standard / Filapaint model, and what costs it its color
 * fidelity on photographs. A band's color is the *mean* of a brightness slice,
 * so a red sky and a pale stone in the same slice average into brown mud, and
 * two details that differ in hue but share a brightness (a face in shadow next
 * to the cloak around it) land in the same filament no matter how many colors
 * the print has.
 *
 * This mode turns the order around — colors first, then the picture built out
 * of them: the palette is a median cut of the image's RGB, each pixel takes the
 * nearest colour, and every color owns one equal slice of the printed height.
 * The result is a poster-like relief whose terraces are the picture's real
 * colors, each printed at its full slice thickness so the colour below cannot
 * show through; only the bottom terrace, lying on the base of its own colour,
 * keeps the local brightness modelling.
 *
 * Physical consistency is preserved: a pixel's relief always lands inside the
 * slice of the color it was assigned (brightness within a band is normalized
 * onto that band's own slice), so the topmost layer at any point is the
 * filament the preview shows.
 *
 * `colorSource` is the image the palette is cut from when it should be smoother
 * than the pixels the labels are read from — the same split the luminance path
 * uses to keep band colors clean without eating the picture's shapes.
 */
export function mapToImageColors(
  rgba: Uint8ClampedArray,
  numColors: number,
  width: number,
  height: number,
  darkIsTall: boolean,
  dither = 0,
  colorSource?: Uint8ClampedArray,
): QuantizedImage {
  const total = width * height
  const n = Math.max(1, numColors)
  const paletteSource = colorSource && colorSource.length === rgba.length ? colorSource : rgba

  // 1. Palette: the picture's distinct colors (see `distinctPalette`), ordered
  //    dark → light the way every other palette in the app is ordered (slot
  //    order = print order).
  const palette = distinctPalette(paletteSource, n)
    .slice()
    .sort((a, b) => lumaOf(a) - lumaOf(b))

  // 2. Labels: nearest palette color (redmean), read from the image that keeps
  //    the picture's shapes — colors decide *which* filament, detail decides
  //    *where* the boundary runs.
  const labels = new Uint8Array(total)
  for (let i = 0; i < total; i++) {
    const p = i * 4
    const r = rgba[p]
    const g = rgba[p + 1]
    const b = rgba[p + 2]
    let best = 0
    let bestD = Infinity
    for (let s = 0; s < palette.length; s++) {
      const c = palette[s]
      const dr = r - c.r
      const dg = g - c.g
      const db = b - c.b
      const rm = (r + c.r) / 2
      const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    labels[i] = best
  }

  const clean = cleanupSmallRegions(labels, width, height)
  const clampedDither = Math.min(1, Math.max(0, dither))
  const finalLabels = clampedDither > 0 ? ditherColors(rgba, clean, palette, width, height, clampedDither) : clean

  // 3. Heights: every color owns one equal slice of the relief and prints as a
  //    plate at the slice top (the bottom slice keeps its brightness
  //    modelling) — see `reliefFromColorBands`.
  const relief = reliefFromColorBands(rgba, finalLabels, palette.length, darkIsTall, width * height)
  const bandTops = Array.from({ length: palette.length }, (_, b) => (b + 1) / palette.length)

  const result: QuantizedImage = {
    palette: palette.map((c) => ({ ...c })),
    indexMap: finalLabels,
    luminance: relief,
    bandTops,
    width,
    height,
  }
  if (finalLabels !== clean) result.cleanIndexMap = clean
  return result
}

/**
 * Build the relief for a color-first palette: every band above the bottom one
 * is a plate at the top of its slice; the bottom band's pixels are stretched
 * over its slice by brightness normalized onto the band's own range (2 %..98 %
 * percentiles, so a handful of stray pixels cannot collapse the modelling).
 *
 * The orientation matches the rest of the pipeline: slice 0 is the bottom of
 * the stack, and with `darkIsTall` the darker half of a band sits nearer its
 * top — the same direction the luminance path orients its relief.
 */
function reliefFromColorBands(
  rgba: Uint8ClampedArray,
  labels: Uint8Array,
  n: number,
  darkIsTall: boolean,
  total: number,
): Float32Array {
  const relief = new Float32Array(total)
  if (n <= 0) return relief

  const bands: number[][] = Array.from({ length: n }, () => [])
  for (let i = 0; i < total; i++) bands[labels[i]!]!.push(i)

  for (let b = 0; b < n; b++) {
    const cells = bands[b]!
    if (cells.length === 0) continue
    const lumas = cells.map((i) => pixelLuma(rgba, i)).sort((a, c) => a - c)
    const at = (fraction: number) => lumas[Math.min(lumas.length - 1, Math.floor((lumas.length - 1) * fraction))]!
    const lo = at(0.02)
    const hi = at(0.98)
    const span = hi - lo
    // Palette slot b is dark → light; its slice in the stack follows the depth
    // mode, exactly as the preview and the swap schedule read it.
    const slice = darkIsTall ? n - 1 - b : b
    const base = slice / n
    for (const i of cells) {
      // A band with no brightness variation of its own (a flat colour patch)
      // prints as a full plate of that colour: every pixel is the band's
      // brightest, so the surface sits at the slice top. That keeps the model
      // reaching the configured height even when the picture is flat inside
      // every colour.
      //
      // Every band above the bottom one is such a plate too. Its sheet lies on
      // a DIFFERENT colour, and a pixel low in its slice would print only a
      // thin sheet of its own filament with that colour showing through — a
      // blue sky over a red band turns pink. At the slice top the colour gets
      // its full thickness. The bottom band sits on the base of its own colour
      // and keeps the brightness modelling.
      const local = span < 1e-6 || slice > 0
        ? 1
        : (() => {
            const v = Math.min(1, Math.max(0, (pixelLuma(rgba, i) - lo) / span))
            return darkIsTall ? 1 - v : v
          })()
      relief[i] = base + local / n
    }
  }
  return relief
}

export function quantizeToPalette(
  rgba: Uint8ClampedArray,
  spools: RGB[],
  width: number,
  height: number,
  dither = 0,
): QuantizedImage {
  const n = spools.length
  const total = width * height
  const labels = new Uint8Array(total)
  for (let i = 0; i < total; i++) {
    const p = i * 4
    const r = rgba[p]
    const g = rgba[p + 1]
    const b = rgba[p + 2]
    let best = 0
    let bestD = Infinity
    for (let s = 0; s < n; s++) {
      const c = spools[s]
      const dr = r - c.r
      const dg = g - c.g
      const db = b - c.b
      const rm = (r + c.r) / 2
      const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    labels[i] = best
  }
  const clean = cleanupSmallRegions(labels, width, height)
  const clampedDither = Math.min(1, Math.max(0, dither))
  const finalIndexMap = clampedDither > 0 ? ditherColors(rgba, clean, spools, width, height, clampedDither) : clean
  // Equal-thickness bands; luminance is unused by the height/printability
  // paths for palette quantization, so it is zero-filled.
  const bandTops = Array.from({ length: n }, (_, b) => (b + 1) / n)
  const result: QuantizedImage = {
    palette: spools.map((c) => ({ ...c })),
    indexMap: finalIndexMap,
    luminance: new Float32Array(total),
    bandTops,
    width,
    height,
  }
  if (finalIndexMap !== clean) result.cleanIndexMap = clean
  return result
}
