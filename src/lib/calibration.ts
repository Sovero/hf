import type { RGB } from './types'
import { buildMesh } from './mesh'
import { generateBinaryStl } from './exportStl'
import { rgbToHex } from './palette'
import { DEFAULT_TAU_MM } from './transmission'

/**
 * Filament-opacity calibration: a printable stepped swatch plus a τ fit from
 * a photo of it.
 *
 * The swatch is a small heightfield model: a flat base slab in the print's
 * base color with seven steps of the calibrated filament on top, each step
 * one contiguous block of a known thickness. Photographed from above, the
 * visible color of a step is exactly the transmission blend
 *   m = T(t)·C + (1 − T(t))·B,
 * so sampling each step's color and inverting the blend recovers the
 * filament's opacity length τ — the same parameter the preview model uses.
 */

/** Step thicknesses (mm), all multiples of 0.2 so they land exactly on the
 * slicer layer grid at the recommended 0.2 mm layer height. */
export const CALIB_STEPS = [0.2, 0.4, 0.6, 0.8, 1.2, 1.6, 2.0]

/** Reference base-slab thickness (mm) — opaque backdrop under every step. */
export const CALIB_BASE_MM = 1.0

/** Swatch footprint (mm): X across the steps, Y the strip depth. */
const SWATCH_W = 60
const SWATCH_D = 14
/** One step: 8 mm wide along X, 12 mm deep along Y (1 mm rim all around). */
const STEP_W = 8
const STEP_D = 12
const STEP_D0 = 1

/** Heightfield cell pitch (mm) — fine enough for crisp step edges. */
const PITCH = 0.25

export interface CalibrationSwatch {
  /** Binary STL of the swatch (base slab + stepped strip). */
  stl: ArrayBuffer
  /** Bilingual print + measure instructions. */
  info: string
}

/**
 * Build the calibration swatch for one filament color. `baseHex` is the print
 * order-1 color the base slab prints in; `layerMm` is only used to compute
 * the recommended swap layer in the instructions.
 */
export function buildCalibrationSwatch(color: RGB, baseHex: string, layerMm: number): CalibrationSwatch {
  const W = Math.round(SWATCH_W / PITCH)
  const H = Math.round(SWATCH_D / PITCH)
  const values = new Float32Array(W * H)
  const stepsW = CALIB_STEPS.length * STEP_W
  const x0 = (SWATCH_W - stepsW) / 2
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) * PITCH
      const y = (j + 0.5) * PITCH
      let h = CALIB_BASE_MM
      const k = Math.floor((x - x0) / STEP_W)
      if (k >= 0 && k < CALIB_STEPS.length && y >= STEP_D0 && y <= STEP_D0 + STEP_D) {
        h = CALIB_BASE_MM + CALIB_STEPS[k]
      }
      values[j * W + i] = h
    }
  }
  const mesh = buildMesh(
    { width: W, height: H, values },
    new Uint8Array(W * H), // STL has no colors; one palette entry suffices
    [color],
    {
      widthMm: SWATCH_W,
      heightMm: SWATCH_D,
      baseMm: CALIB_BASE_MM,
      maxHeightMm: CALIB_BASE_MM + Math.max(...CALIB_STEPS),
      darkIsTall: true,
      layerMm,
    },
  )
  const swapLayer = Math.max(1, Math.round(CALIB_BASE_MM / layerMm))
  const hex = rgbToHex(color)
  const steps = CALIB_STEPS.map((t, k) => `  ${k + 1}. ${t.toFixed(2)} mm`).join('\n')
  const info = [
    '==============================================',
    `HueForge Web — calibration swatch for ${hex}`,
    '==============================================',
    `Layout: ${SWATCH_W} x ${SWATCH_D} mm; base slab ${CALIB_BASE_MM.toFixed(2)} mm in ${baseHex},`,
    'then 7 steps of the calibrated filament left → right:',
    steps,
    '',
    `Print: ${layerMm.toFixed(2)} mm layers, 100% infill, no supports, top face up.`,
    `Single-extruder: the base prints first (layers 1..${swapLayer - 1}), swap to ${hex}`,
    `at the start of layer ${swapLayer}.`,
    '',
    '--- EN ---',
    'Measure: photograph the finished swatch straight-on in even light (no glare),',
    'then in HueForge Web open Palette → Calibrate, load the photo and click the',
    'bare base area first, then each step from thinnest to thickest. The app',
    'samples each click and fits the opacity length τ for this filament.',
    '',
    '--- RU ---',
    'Измерение: сфотографируйте готовый образец строго сверху при ровном свете',
    '(без бликов), затем в HueForge Web откройте «Палитра → Калибровка»,',
    'загрузите фото и щёлкните сначала по чистому основанию, потом по каждой',
    'ступени от тонкой к толстой. Приложение измерит цвета и подберёт параметр',
    'непрозрачности τ для этого филамента.',
    '',
  ].join('\n')
  return { stl: generateBinaryStl(mesh), info }
}

export interface CalibSample {
  /** Nominal step thickness in mm (CALIB_STEPS entry). */
  thicknessMm: number
  /** Mean photo color sampled from that step. */
  rgb: RGB
}

const chan = (c: RGB): [number, number, number] => [c.r, c.g, c.b]
const lum = (c: RGB): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

/**
 * Fit the opacity length τ (mm) from photo samples of the swatch.
 *
 * `baseMeasured` — mean color of the bare base area in the same photo: it
 * absorbs camera exposure/white balance, so the fit is light-normalized.
 * `baseTrue` / `colorTrue` — the palette hexes of the base and calibrated
 * filaments (their ratios define the per-channel exposure scale).
 *
 * Per step and channel: T = (m − B) / (C − B), τ = −t / ln(1 − T); channels
 * indistinguishable from the base are skipped, and the result is the median
 * over all valid estimates (robust to one stray click). Falls back to
 * DEFAULT_TAU_MM when nothing is measurable (e.g. color ≈ base).
 */
export function fitTau(
  samples: CalibSample[],
  baseMeasured: RGB,
  baseTrue: RGB,
  colorTrue: RGB,
): number {
  const B = chan(baseMeasured)
  const bt = chan(baseTrue)
  const ct = chan(colorTrue)
  // Exposure scale per channel: measured ≈ scale × true (black point ≈ 0 for
  // printed plastic). Channels too dark in the true base fall back to the
  // luminance ratio.
  const l = lum(baseMeasured) / Math.max(1e-6, lum(baseTrue))
  const scale = [0, 1, 2].map((ch) => (bt[ch] > 40 ? B[ch] / bt[ch] : NaN))
  const a = scale.map((v) => (Number.isFinite(v) && v > 0 ? v : l))
  const C = [0, 1, 2].map((ch) => ct[ch] * a[ch])

  const est: number[] = []
  for (const s of samples) {
    const m = chan(s.rgb)
    for (let ch = 0; ch < 3; ch++) {
      const denom = C[ch] - B[ch]
      if (Math.abs(denom) < 25) continue // channel blends into the base
      const T = (m[ch] - B[ch]) / denom
      if (T <= 0.02 || T >= 0.98) continue // outside the measurable range
      est.push(-s.thicknessMm / Math.log(1 - T))
    }
  }
  if (est.length === 0) return DEFAULT_TAU_MM
  est.sort((x, y) => x - y)
  const mid = est.length >> 1
  const median = est.length % 2 ? est[mid] : (est[mid - 1] + est[mid]) / 2
  return Math.min(8, Math.max(0.15, median))
}
