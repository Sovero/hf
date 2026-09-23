#!/usr/bin/env node
/**
 * Генератор иконки приложения: build/icon.ico (иконка exe и установщика),
 * build/icon.png 512px (Linux-бандлы) и public/favicon.png 64px (значок
 * вкладки веб-версии — Vite копирует public/ в dist как есть).
 * Рисуется программно, без внешних ассетов: изометрическая
 * ступенчатая стопка — слои филамента, из которых HueForge собирает рельеф
 * (нижний слой самый широкий, верхний — самая светлая площадка). Палитра
 * ведёт от сливы к кремовому, как градиент смены филаментов в печати.
 * Запускается вручную: `node scripts/make-icon.mjs`.
 *
 * ICO собирается вручную (простой бинарный формат: PNG-записи внутри ICO
 * контейнера), чтобы не тянуть зависимости в скрипт.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url)) + '/..'
const buildDir = join(root, 'build')
const publicDir = join(root, 'public')
mkdirSync(buildDir, { recursive: true })
mkdirSync(publicDir, { recursive: true })

/** Канал в 0..255: без зажима Buffer заворачивает пересвет по модулю 256. */
function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/** RGBA-холст с попиксельным доступом. */
function canvas(size) {
  const data = Buffer.alloc(size * size * 4)
  return {
    size,
    data,
    set(x, y, [r, g, b, a]) {
      const i = (y * size + x) * 4
      data[i] = clamp255(Math.round(r))
      data[i + 1] = clamp255(Math.round(g))
      data[i + 2] = clamp255(Math.round(b))
      data[i + 3] = clamp255(Math.round(a))
    },
  }
}

/* ── Геометрия и палитра знака ───────────────────────────────────────────
 * Координаты — доли стороны иконки (0..1), поэтому один и тот же чертёж
 * масштабируется в любой размер.
 */
const TILE_RADIUS = 0.235 // скругление плитки
const ISO_W = 0.305       // половина ширины опорного ромба
const ISO_H = 0.1525      // половина высоты ромба (изометрия 2:1)
const STACK_H = 0.33      // высота всей стопки на экране
const TOP_SCALE = 0.35    // во сколько раз верхняя площадка уже нижней

/** Палитра слоёв снизу вверх: слива → киноварь → оранжевый → янтарь → крем. */
const RAMP = [
  [0x9b, 0x2d, 0x60],
  [0xc0, 0x37, 0x36],
  [0xe8, 0x76, 0x2c],
  [0xf2, 0xb0, 0x40],
  [0xf7, 0xe4, 0xba],
]

/** Смешать две RGB-тройки. */
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** Цвет слоя layer из n по общей палитре. */
function layerColor(layer, n) {
  const pos = (n === 1 ? 0 : layer / (n - 1)) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(pos))
  return mix(RAMP[i], RAMP[i + 1], pos - i)
}

/**
 * Знак как ступенчатая пирамида из n плит: плита i занимает модельную высоту
 * [i, i+1] и опорный квадрат со стороной halfSize[i]; верхняя — самая узкая.
 * Проекция изометрии 2:1: sx = OX + (x - z)·ISO_W, sy = OY + (x + z)·ISO_H - y·V.
 */
function pyramid(n) {
  const v = STACK_H / n // высота одной плиты на экране
  const top = TOP_SCALE
  const steps = Math.max(1, n - 1)
  const halfSize = Array.from({ length: n }, (_, i) => 1 - (i * (1 - top)) / steps)
  // Вертикальный размах фигуры: от заднего угла верхней площадки до переднего
  // угла нижней плиты; сдвигаем начало координат так, чтобы фигура встала по
  // центру плитки.
  const back = -2 * top * ISO_H - STACK_H
  const front = 2 * ISO_H
  const ox = 0.5
  const oy = 0.5 - (back + front) / 2
  return { n, v, halfSize, ox, oy }
}

/** Фон плитки: холодный верх → тёплый низ и «на просвет» свечение за знаком. */
function background(u, v) {
  const t = Math.min(1, Math.max(0, u * 0.3 + v * 0.7))
  const base = mix([0x0e, 0x14, 0x1c], [0x22, 0x1f, 0x25], t)
  const d = Math.hypot(u - 0.5, v - 0.6)
  const glow = Math.max(0, 1 - d / 0.62) ** 2
  return mix(base, [0xff, 0x8a, 0x3a], glow * 0.22)
}

/**
 * Какая грань плиты i накрывает точку экрана (u, v): 0 — верхняя площадка,
 * 1 — правая грань (x = a), 2 — левая грань (z = a). Грани выпуклой плиты на
 * экране не пересекаются, поэтому достаточно первой подошедшей.
 */
function faceAt(pyr, u, v, i) {
  const { v: V, halfSize, ox, oy } = pyr
  const a = halfSize[i]
  const y0 = i
  const y1 = i + 1
  // верхняя площадка лежит на высоте y1
  const dx = (u - ox) / ISO_W
  const dz = (v - oy + y1 * V) / ISO_H
  const tx = (dx + dz) / 2
  const tz = (dz - dx) / 2
  if (tx >= -a && tx <= a && tz >= -a && tz <= a) {
    return { face: 0, x: tx, z: tz, y: y1, t: (tx + tz + 2 * a) / (4 * a), i }
  }
  // правая грань — вдоль фиксированного x = a
  const rz = a - (u - ox) / ISO_W
  if (rz >= -a && rz <= a) {
    const ry = (oy + (a + rz) * ISO_H - v) / V
    if (ry >= y0 && ry <= y1) return { face: 1, x: a, z: rz, y: ry, t: (rz + a) / (2 * a), i }
  }
  // левая грань — вдоль фиксированного z = a
  const lx = (u - ox) / ISO_W + a
  if (lx >= -a && lx <= a) {
    const ly = (oy + (lx + a) * ISO_H - v) / V
    if (ly >= y0 && ly <= y1) return { face: 2, x: lx, z: a, y: ly, t: (lx + a) / (2 * a), i }
  }
  return null
}

/** Освещение: сверху ярче всего, левая грань темнее, правая — самая тёмная. */
function shade(hit, n) {
  const base = layerColor(hit.i, n)
  let k
  if (hit.face === 0) {
    k = 0.84 + 0.16 * hit.t // площадка светлее к переднему краю (и не в пересвет)
  } else {
    // у боковых граней свет падает сверху: низ плиты темнее её верха —
    // так на стопке читается граница между слоями
    const up = hit.y - hit.i
    k = (hit.face === 1 ? 0.62 * (0.94 + 0.12 * hit.t) : 0.82 * (0.92 + 0.12 * hit.t))
    k *= 0.94 + 0.06 * up
  }
  return [base[0] * k, base[1] * k, base[2] * k]
}

/** Сэмплер цвета плитки: (u, v) в долях стороны → RGBA 0..255, a — покрытие. */
function makeSampler(size, n) {
  const pyr = pyramid(n)
  const edge = 0.5 / size // ширина сглаживания плитки в долях стороны
  return (u, v) => {
    // закруглённый квадрат: SDF в долях стороны
    const qx = Math.abs(u - 0.5) - (0.5 - TILE_RADIUS)
    const qy = Math.abs(v - 0.5) - (0.5 - TILE_RADIUS)
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - TILE_RADIUS
    const cover = Math.min(1, Math.max(0, 0.5 - d / edge))
    if (cover <= 0) return [0, 0, 0, 0]

    let [r, g, b] = background(u, v)
    // Стопка снизу вверх, без раннего выхода: каждая следующая плита
    // перекрывает ту, что под ней (это и есть painter's algorithm — верхние
    // плиты ближе к зрителю, потому что стоят на нижних).
    for (let i = 0; i < n; i++) {
      const hit = faceAt(pyr, u, v, i)
      if (hit) [r, g, b] = shade(hit, n)
    }
    // мягкий блик по верхней кромке плитки
    const inner = Math.min(1, Math.max(0, (d + 0.02) / 0.02))
    const lit = inner * Math.max(0, 1 - v / 0.45) * 0.14
    ;[r, g, b] = mix([r, g, b], [0xff, 0xff, 0xff], lit)
    return [r, g, b, cover]
  }
}

/**
 * Нарисовать иконку size×size. Мелкие размеры получают меньше ступеней:
 * на 16–20 px плита шириной в пиксель слилась бы в грязь, поэтому стопка
 * нарисована тремя крупными слоями вместо пяти (силуэт тот же).
 */
function drawIcon(size) {
  const n = size <= 20 ? 3 : size <= 40 ? 4 : 5
  const ss = size >= 192 ? 2 : size >= 64 ? 3 : 4 // суперсэмплинг
  const sample = makeSampler(size, n)
  const cv = canvas(size)
  const step = 1 / ss
  const inv = 1 / (ss * ss)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ar = 0
      let ag = 0
      let ab = 0
      let aa = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) * step) / size
          const v = (y + (sy + 0.5) * step) / size
          const [r, g, b, a] = sample(u, v)
          ar += r * a
          ag += g * a
          ab += b * a
          aa += a
        }
      }
      if (aa <= 0) {
        cv.set(x, y, [0, 0, 0, 0])
        continue
      }
      // премультиплицированное усреднение: без тёмного ореола по краю плитки
      cv.set(x, y, [ar / aa, ag / aa, ab / aa, aa * inv * 255])
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

/** ICO-контейнер из PNG-записей: сначала весь каталог, потом все данные. */
function buildIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)   // reserved, всегда 0
  header.writeUInt16LE(1, 2)   // 1 = ICO (тип ресурса)
  header.writeUInt16LE(pngs.length, 4) // счётчик изображений внутри
  const entries = []
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
    entries.push(entry)
    images.push(png)
  }
  // Важно: каталог (все 16-байтные записи) идёт единым блоком сразу после
  // заголовка, и только затем — данные изображений. Смещения в записях
  // рассчитаны именно на такую компоновку; чередование записей с данными
  // даёт невалидный файл, который resedit падает парсить.
  return Buffer.concat([header, ...entries, ...images])
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const FAVICON_SIZE = 64 // хватает и на вкладке (16/32px), и на HiDPI

// Файлы пишутся только при запуске скрипта напрямую: при импорте (превью
// размеров в .freebuff) нужны лишь сами функции отрисовки.
const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  const ico = buildIco(sizes.map((s) => drawIcon(s)))
  writeFileSync(join(buildDir, 'icon.ico'), ico)
  writeFileSync(join(buildDir, 'icon.png'), encodePng(drawIcon(512)))
  writeFileSync(join(publicDir, 'favicon.png'), encodePng(drawIcon(FAVICON_SIZE)))
  console.log(
    `icon.ico (${sizes.join(', ')}), icon.png (512) — build/, favicon.png (${FAVICON_SIZE}) — public/`,
  )
}

export { drawIcon, encodePng, buildIco, canvas, sizes }
