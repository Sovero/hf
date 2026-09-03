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

/** Result of color quantization: a palette plus per-pixel palette indices. */
export interface QuantizedImage {
  /** Palette sorted darkest → lightest. */
  palette: RGB[]
  /** Per-pixel index into `palette`. */
  indexMap: Uint8Array
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