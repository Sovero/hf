import type { LoadedImage } from './types'
import { t, type Lang } from '../i18n'

const MAX_DIMENSION = 512
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
    return rasterize(bitmap, lang)
  } finally {
    bitmap.close()
  }
}

function rasterize(bitmap: ImageBitmap, lang: Lang): LoadedImage {
  const { width, height } = bitmap
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
  const outW = Math.max(1, Math.round(width * scale))
  const outH = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error(t(lang, 'errCanvas'))

  // White backdrop: transparency in the source becomes white.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, outW, outH)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, outW, outH)

  const { data } = ctx.getImageData(0, 0, outW, outH)
  return { width: outW, height: outH, rgba: data }
}