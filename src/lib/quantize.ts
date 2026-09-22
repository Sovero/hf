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
 * Assign every pixel to one of `numColors` luminance bands and derive the
 * band colors from the image itself.
 *
 * HueForge-style: a pixel's brightness decides how tall its column is, and
 * therefore which filament band its top surface ends in. Band 0 covers the
 * lowest relief slice and is printed first (bottom); its pixels are the
 * darkest (or, with `darkIsTall`, the brightest — the relief is inverted).
 *
 * Bands are equal-population, not equal-width: pixels are ordered by relief
 * position and each band takes the next slice of ~1/N of the pixels. This
 * guarantees every filament color covers at least ~100/N % of the print's
 * painted area, whatever the image's brightness histogram looks like.
 *
 * The palette is NOT a separate color quantization: each band's color is the
 * average color of the pixels assigned to it, so a colorful image keeps the
 * hues its brightness slices actually contain. Because Rec.709 luma is
 * linear, band means are automatically ordered dark → light, and empty bands
 * (fewer pixels than colors) inherit the color of the nearest populated band.
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

/** Equal-population band labels for a relief array (0 = bottom band). */
function bandLabels(x: Float32Array, n: number, darkIsTall: boolean, pixelCount: number): Uint8Array {
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
    const rank = cum[bin] + rankInBin[bin]++
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
): QuantizedImage {
  const pixelCount = width * height
  const n = Math.max(1, numColors)
  const raw = new Float32Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) raw[i] = pixelLuma(rgba, i)
  const [lo, hi] = contrastRange(raw)
  const span = Math.max(1e-6, hi - lo)

  // Per-pixel relief position x (0 = base, 1 = tallest). Deliberately *before*
  // the tone curve: band assignment, speck cleanup, band tops and dithering
  // all read the untouched relief, so contrast and power cannot move a color
  // boundary by even one pixel. The curve is applied to the heights and the
  // band tops together at the end (see `applyToneToRelief`).
  const x = new Float32Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    let v = Math.min(1, Math.max(0, (raw[i] - lo) / span))
    if (darkIsTall) v = 1 - v
    x[i] = v
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
  const canClean = width >= 3 && height >= 3
  let relief: Float32Array = x
  if (canClean) {
    for (let pass = 0; pass < 8; pass++) {
      const labels0 = bandLabels(relief, n, darkIsTall, pixelCount)
      const cleaned = removeIsolatedRegions(relief, labels0, width, height, MIN_REGION_CELLS)
      const labels1 = bandLabels(cleaned, n, darkIsTall, pixelCount)
      const remaining = components(labels1, width, height).filter((c) => c.cells.length < MIN_REGION_CELLS).length
      relief = cleaned
      if (remaining === 0) break
    }
  }

  // Assign bands by rank on the cleaned relief: each band takes the next
  // slice of ⌊count/n⌋ or ⌈count/n⌉ pixels, so no color covers a
  // negligible area and no speck can survive.
  const indexMap = bandLabels(relief, n, darkIsTall, pixelCount)
  const bandTops = bandTopsFrom(relief, n, pixelCount)

  // Band colors = mean color of the pixels in each slice (dark → light). The
  // slice membership is the boundary map above; the pixels that get averaged
  // may come from a cleaner image (`colorSource`), so a noisy boundary does
  // not smear mud into the filament colors.
  const colors = colorSource && colorSource.length === rgba.length ? colorSource : rgba
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
 * colors; the shading *inside* a terrace still follows the local brightness, so
 * a region keeps its modelling instead of flattening into a plateau.
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

  // 1. Palette: median cut of the picture's RGB, ordered dark → light the way
  //    every other palette in the app is ordered (slot order = print order).
  const palette = quantize(paletteSource, n)
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

  // 3. Heights: every color owns one equal slice of the relief; a pixel sits
  //    inside its own slice, positioned by its brightness *relative to its
  //    band* — so the band keeps its local modelling and never leaves its
  //    filament's range.
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
 * Turn vertical cliffs into printable slopes.
 *
 * In the color-first model a color boundary IS a height step: neighbours that
 * print in different filaments must sit in different height slices, so every
 * boundary is a wall at least one slice tall. That is physical — the top layer
 * has to be the filament the picture asks for — but unmodified it prints as a
 * picket fence of vertical fins wherever colours interleave (a detailed photo
 * has hundreds of small regions, each of them a terrace one slice high).
 *
 * This pass caps how much higher a pixel may stand than its 4-neighbours: one
 * layer of height per cell, i.e. a ~27° face, which any FDM printer makes
 * without support. Repeated passes spread a step into a ramp a few cells wide,
 * so boundaries read as slopes and the surface stays a relief instead of a
 * comb. Flat areas are untouched (equal neighbours never move anything), and
 * the picture's colours do not change — the top surface near a boundary simply
 * lands in one of the two filaments a cell earlier or later.
 *
 * Returns a new array; the input is never mutated.
 */
export function relaxCliffs(
  field: Float32Array,
  width: number,
  height: number,
  maxStep: number,
  passes = 12,
): Float32Array {
  if (!(maxStep > 0) || width < 2 || height < 2 || field.length !== width * height) return field
  let current = Float32Array.from(field)
  let next = new Float32Array(current.length)
  for (let pass = 0; pass < passes; pass++) {
    let moved = false
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const v = current[i]!
        let lo = -Infinity
        let hi = Infinity
        if (x > 0) { lo = Math.max(lo, current[i - 1]! - maxStep); hi = Math.min(hi, current[i - 1]! + maxStep) }
        if (x < width - 1) { lo = Math.max(lo, current[i + 1]! - maxStep); hi = Math.min(hi, current[i + 1]! + maxStep) }
        if (y > 0) { lo = Math.max(lo, current[i - width]! - maxStep); hi = Math.min(hi, current[i - width]! + maxStep) }
        if (y < height - 1) { lo = Math.max(lo, current[i + width]! - maxStep); hi = Math.min(hi, current[i + width]! + maxStep) }
        const clamped = Math.min(Math.max(v, lo), hi)
        next[i] = clamped
        if (clamped !== v) moved = true
      }
    }
    const swap = current
    current = next
    next = swap
    if (!moved) break
  }
  return current
}

/**
 * Build the relief for a color-first palette: each band's pixels are stretched
 * over that band's own slice of the height, using the pixel's brightness
 * normalized onto the band's brightness range (2 %..98 % percentiles, so a
 * handful of stray pixels cannot collapse the modelling to a flat plateau).
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
      const local = span < 1e-6
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
