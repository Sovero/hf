import type { LoadedImage } from './types'
import { t, type Lang } from '../i18n'
import { MAX_DIMENSION, fitResolution } from './printConsts'

/** Reject files this large up front, before the decoder sees them. */
const MAX_FILE_BYTES = 64 * 1024 * 1024
/**
 * Absolute cap on decoded dimensions (guards against decompression bombs:
 * tiny files that decode to enormous bitmaps). Peak memory stays ≤ ~256 MB
 * even for pathological input.
 */
const ABSOLUTE_MAX_DIMENSION = 8192

/**
 * Decode an image file and return RGBA pixel data at a workable size.
 * Composites transparency onto white (transparent pixels become white),
 * which matches how a print viewed from above behaves.
 *
 * The working resolution fits the print size (see `fitResolution`): each
 * image cell is at least one nozzle wide, so fine detail survives instead of
 * structurally dissolving below the nozzle. The printer settings are not
 * known at decode time, so the caller re-decodes via `rasterizeToSize` when
 * the fitted size differs — see `loadImageForPrint` in the pipeline.
 */
export async function loadImageFromFile(file: File, lang: Lang = 'en'): Promise<LoadedImage> {
  const err = (key: string, params?: Record<string, string>) => t(lang, key, params)
  if (!file.type.startsWith('image/')) {
    throw new Error(err('errNotAnImage', { name: file.name }))
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(err('errTooLarge', { name: file.name, size: (file.size / 1024 / 1024).toFixed(1) }))
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(err('errDecode'))
  }
  if (bitmap.width > ABSOLUTE_MAX_DIMENSION || bitmap.height > ABSOLUTE_MAX_DIMENSION) {
    const dims = `${bitmap.width}×${bitmap.height}`
    bitmap.close()
    throw new Error(err('errDims', { dims, limit: String(ABSOLUTE_MAX_DIMENSION) }))
  }

  try {
    return rasterizeToSize(bitmap, Math.min(MAX_DIMENSION, bitmap.width), Math.min(MAX_DIMENSION, bitmap.height))
  } finally {
    bitmap.close()
  }
}

/**
 * Decode sized for the print: the larger axis is capped at
 * `fitResolution(max(print width, height))` and the aspect ratio preserved,
 * so no cell is smaller than the nozzle. Returns the image plus the bitmap
 * size so the caller can detect a no-op.
 */
export async function loadImageForPrint(
  file: File,
  printWidthMm: number,
  printHeightMm: number,
  lang: Lang = 'en',
): Promise<{ image: LoadedImage; sourceWidth: number; sourceHeight: number }> {
  const err = (key: string, params?: Record<string, string>) => t(lang, key, params)
  if (!file.type.startsWith('image/')) {
    throw new Error(err('errNotAnImage', { name: file.name }))
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(err('errTooLarge', { name: file.name, size: (file.size / 1024 / 1024).toFixed(1) }))
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(err('errDecode'))
  }
  if (bitmap.width > ABSOLUTE_MAX_DIMENSION || bitmap.height > ABSOLUTE_MAX_DIMENSION) {
    const dims = `${bitmap.width}×${bitmap.height}`
    bitmap.close()
    throw new Error(err('errDims', { dims, limit: String(ABSOLUTE_MAX_DIMENSION) }))
  }

  try {
    const cap = fitResolution(Math.max(printWidthMm, printHeightMm))
    const scale = Math.min(1, cap / Math.max(bitmap.width, bitmap.height))
    const outW = Math.max(1, Math.round(bitmap.width * scale))
    const outH = Math.max(1, Math.round(bitmap.height * scale))
    return { image: rasterizeToSize(bitmap, outW, outH), sourceWidth: bitmap.width, sourceHeight: bitmap.height }
  } finally {
    bitmap.close()
  }
}

function rasterizeToSize(bitmap: ImageBitmap, outW: number, outH: number): LoadedImage {
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error(t('en', 'errCanvas'))

  // White backdrop: transparency in the source becomes white.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, outW, outH)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, outW, outH)

  const { data } = ctx.getImageData(0, 0, outW, outH)
  return { width: outW, height: outH, rgba: data }
}
