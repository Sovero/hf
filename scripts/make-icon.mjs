#!/usr/bin/env node
/**
 * Генератор иконки приложения: build/icon.ico (+ build/icon.png 512px для
 * Linux-бандлов). Рисует программно (без внешних ассетов): тёплый градиент —
 * отсылка к слоям филамента, ступенчатый рельеф — суть HueForge. Запускается
 * один раз вручную: `node scripts/make-icon.mjs`.
 *
 * ICO собирается вручную (простой бинарный формат: PNG-записи внутри ICO
 * контейнера), чтобы не тянуть зависимости в скрипт.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url)) + '/..'
const buildDir = join(root, 'build')
mkdirSync(buildDir, { recursive: true })

/** RGBA-холст с попиксельным доступом. */
function canvas(size) {
  const data = Buffer.alloc(size * size * 4)
  return {
    size,
    data,
    set(x, y, [r, g, b, a]) {
      const i = (y * size + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    },
  }
}

/** Закруглённый квадрат: >0 внутри, с мягким антиалиасингом по краю. */
function roundedSdf(x, y, size, radius) {
  const half = size / 2 - 0.5
  const qx = Math.abs(x - half) - (half - radius)
  const qy = Math.abs(y - half) - (half - radius)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius
}

/** Ступенчатый «рельеф» из трёх полос, поднимающихся слева направо. */
function reliefHeight(x, y, size) {
  const u = x / size
  const v = y / size
  // три ступени; чем ниже ступень, тем выше яркость
  const step = v < 0.45 ? 0.85 : v < 0.7 ? 0.55 : 0.3
  // диагональный наклон добавляет объём
  return step + (1 - u) * 0.15
}

/**
 * Нарисовать иконку на холсте size×size: закруглённый квадрат с тёплым
 * градиентом (закат) и тремя ступенями рельефа с мягкой тенью.
 */
function drawIcon(size) {
  const cv = canvas(size)
  const radius = size * 0.22
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = roundedSdf(x, y, size, radius)
      // антиалиасинг: 1px вокруг границы
      const alpha = Math.max(0, Math.min(1, 0.5 - d))
      if (alpha <= 0) {
        cv.set(x, y, [0, 0, 0, 0])
        continue
      }
      const u = x / size
      const v = y / size
      // фон: тёмно-синий -> тёплый закатный низ
      const bgR = Math.round(16 + u * 30 + (1 - v) * 10)
      const bgG = Math.round(20 + u * 18 + (1 - v) * 12)
      const bgB = Math.round(24 + u * 22)
      const h = reliefHeight(x, y, size)
      // рельеф: чем выше ступень, тем светлее и теплее
      const layerT = Math.max(0, Math.min(1, (h - 0.25) / 0.75))
      const r = Math.round(bgR * (1 - layerT * 0.35) + 255 * layerT * 0.85)
      const g = Math.round(bgG * (1 - layerT * 0.35) + 150 * layerT * 0.8)
      const b = Math.round(bgB * (1 - layerT * 0.35) + 60 * layerT * 0.7)
      cv.set(x, y, [r, g, b, Math.round(alpha * 255)])
    }
  }
  return cv
}

/** Кодирование RGBA-холста в PNG (без zlib: uncompressed deflate-блоки). */
function encodePng(cv) {
  const { size, data } = cv
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    data.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  // zlib-контейнер с stored-блоками
  const chunks = []
  const maxBlock = 65535
  for (let off = 0; off < raw.length; off += maxBlock) {
    const end = Math.min(off + maxBlock, raw.length)
    const block = raw.subarray(off, end)
    const isLast = end === raw.length ? 1 : 0
    const header = Buffer.alloc(5)
    header[0] = isLast
    header.writeUInt16LE(block.length, 1)
    header.writeUInt16LE(~block.length & 0xffff, 3)
    chunks.push(header, block)
  }
  const adler = (() => {
    let a = 1
    let b = 0
    for (const byte of raw) {
      a = (a + byte) % 65521
      b = (b + a) % 65521
    }
    const buf = Buffer.alloc(4)
    buf.writeUInt32BE(((b << 16) | a) >>> 0, 0)
    return buf
  })()
  const zlib = Buffer.concat([Buffer.from([0x78, 0x01]), ...chunks, adler])

  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, body) => {
    const head = Buffer.alloc(4)
    head.writeUInt32BE(body.length, 0)
    const typeBuf = Buffer.from(type, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])), 0)
    return Buffer.concat([head, typeBuf, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** ICO-контейнер из PNG-записей. */
function buildIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)   // reserved, всегда 0
  header.writeUInt16LE(1, 2)   // 1 = ICO (тип ресурса)
  header.writeUInt16LE(pngs.length, 4) // счётчик изображений внутри
  const images = []
  let offset = 6 + pngs.length * 16
  for (const size of pngs) {
    const png = encodePng(size)
    const entry = Buffer.alloc(16)
    entry[0] = size.size >= 256 ? 0 : size.size
    entry[1] = size.size >= 256 ? 0 : size.size
    entry[2] = 0 // palette
    entry[3] = 0 // reserved
    entry.writeUInt16LE(1, 4) // color planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    images.push(entry, png)
  }
  return Buffer.concat([header, ...images])
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const ico = buildIco(sizes.map((s) => drawIcon(s)))
writeFileSync(join(buildDir, 'icon.ico'), ico)
writeFileSync(join(buildDir, 'icon.png'), encodePng(drawIcon(512)))
console.log(`icon.ico (${sizes.join(', ')}) и icon.png (512) записаны в build/`)
