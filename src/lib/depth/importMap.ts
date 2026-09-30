import { fitDepthWithin, normalizeMinMax, type DepthMap } from './depthMap'
import { decodePng } from './png'

/**
 * A depth or height map the user brings (a PNG from a depth tool, Blender, a
 * sculpting program…) as the relief source. Brighter = nearer/taller by default;
 * the "invert depth" switch flips the other convention.
 */

/** Refuse files past this size before reading them into memory. */
export const MAX_DEPTH_FILE_BYTES = 64 * 1024 * 1024

/** A kept map never needs more than this many pixels on a side: the print grid is ≤ ~1024. */
export const IMPORT_KEEP_SIDE = 2048

export interface ImportedDepth {
  map: DepthMap
  /** 1 where the file had no depth (fully transparent), else 0; absent when nothing was transparent. */
  background?: DepthMap
  /** Precision of the file: 16-bit maps keep all their levels. */
  bitDepth: 8 | 16
  /** Some pixels were fully transparent and were treated as background (base level). */
  hadBackground: boolean
  /** The file carried no usable range (a solid image). */
  flat: boolean
}

/** Transparent pixels carry no depth: below this alpha a pixel is background. */
const BACKGROUND_ALPHA = 0.01

export function importDepthFromPng(bytes: Uint8Array): ImportedDepth {
  const png = decodePng(bytes)
  let background: Uint8Array | undefined
  if (png.alpha) {
    const mask = new Uint8Array(png.alpha.length)
    let any = false
    for (let i = 0; i < mask.length; i++) {
      if (png.alpha[i]! < BACKGROUND_ALPHA) {
        mask[i] = 1
        any = true
      }
    }
    if (any) background = mask
  }
  const { data, flat } = normalizeMinMax(png.luma, background)
  const full: DepthMap = { width: png.width, height: png.height, data }
  return {
    map: fitDepthWithin(full, IMPORT_KEEP_SIDE),
    background: background
      ? fitDepthWithin({ width: png.width, height: png.height, data: Float32Array.from(background) }, IMPORT_KEEP_SIDE)
      : undefined,
    bitDepth: png.bitDepth,
    hadBackground: !!background,
    flat,
  }
}
