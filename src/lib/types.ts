export interface RGB {
  r: number
  g: number
  b: number
}

/** A decoded, downscaled image ready for processing. */
export interface LoadedImage {
  width: number
  height: number
  /** RGBA pixel data, row-major, 4 bytes per pixel. */
  rgba: Uint8ClampedArray
}

/**
 * Result of quantization: the ordered filament palette plus, for every pixel,
 * which filament band it belongs to and its normalized relief position.
 */
export interface QuantizedImage {
  /** Palette sorted darkest → lightest (band colors, printable order dark→light). */
  palette: RGB[]
  /** Per-pixel index into `palette` — the color its top surface will show. */
  indexMap: Uint8Array
  /**
   * Per-pixel relief position 0..1 along the print height (0 = printed first,
   * at the base; 1 = printed last, tallest). Brightness-derived: with
   * darkIsTall it is inverted so dark image areas stand the tallest.
   */
  luminance: Float32Array
  width: number
  height: number
}

/** Per-pixel heights in mm. */
export interface HeightField {
  width: number
  height: number
  /** Per-pixel height in mm, row-major. */
  values: Float32Array
}

/** A triangle mesh with per-vertex colors (3 floats per vertex). */
export interface Mesh {
  /** Flat (non-indexed) vertex positions, xyz triples. */
  positions: Float32Array
  /** Flat vertex colors, rgb triples in 0..1 (sRGB). */
  colors: Float32Array
  /** Triangle count. */
  triangleCount: number
}

/** Model geometry settings, all in mm. */
export interface PrintSettings {
  /** Footprint width in mm. */
  widthMm: number
  /** Footprint height (Y axis) in mm. */
  heightMm: number
  /** Base slab thickness in mm. */
  baseMm: number
  /** Total model height (base + all color bands) in mm. */
  maxHeightMm: number
  /** Whether the darkest color is tallest (printed last, on top). */
  darkIsTall: boolean
}