/**
 * Assemble the self-contained deploy package:
 *   hueforge-web-deploy-v<version>.zip  —  dist/ + server.mjs + deploy.bat + DEPLOY.md
 *
 * Zero dependencies: writes a stored (uncompressed-entry-optional) ZIP by hand
 * — entries are deflate-compressed via node:zlib. Needs `npm run build` first.
 */
import { createWriteStream } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { deflateRawSync, crc32 } from 'node:zlib'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'dist')
const VERSION = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version
const OUT = join(ROOT, `hueforge-web-deploy-v${VERSION}.zip`)

const EXTRA_FILES = ['server.mjs', 'slicer-launch.mjs', 'deploy.bat', 'deploy-slicer.bat', 'DEPLOY.md']

/** Collect every file under dir as absolute paths. */
async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(p)))
    else out.push(p)
  }
  return out
}

const files = [...(await walk(DIST)), ...EXTRA_FILES.map((f) => join(ROOT, f))]
const entries = []
for (const abs of files) {
  const rel = relative(ROOT, abs).split(sep).join('/')
  const data = await readFile(abs)
  const compressed = deflateRawSync(data, { level: 9 })
  entries.push({ rel, data, compressed, crc: crc32(data) >>> 0 })
}

// Central directory + local headers (little-endian, deflate method 8).
const chunks = []
const central = []
let offset = 0
const dosTime = (() => {
  const d = new Date()
  return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xffff
})()
const dosDate = (() => {
  const d = new Date()
  return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff
})()

for (const e of entries) {
  const name = Buffer.from(e.rel, 'utf8')
  const useDeflate = e.compressed.length < e.data.length
  const payload = useDeflate ? e.compressed : e.data
  const method = useDeflate ? 8 : 0
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4) // version needed
  local.writeUInt16LE(0, 6) // flags
  local.writeUInt16LE(method, 8)
  local.writeUInt16LE(dosTime, 10)
  local.writeUInt16LE(dosDate, 12)
  local.writeUInt32LE(e.crc, 14)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(e.data.length, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)
  chunks.push(local, name, payload)
  central.push({ e, name, payloadLen: payload.length, method, offset })
  offset += local.length + name.length + payload.length
}

const centralStart = offset
let centralSize = 0
for (const c of central) {
  const rec = Buffer.alloc(46)
  rec.writeUInt32LE(0x02014b50, 0)
  rec.writeUInt16LE(20, 4) // version made by
  rec.writeUInt16LE(20, 6) // version needed
  rec.writeUInt16LE(0, 8)
  rec.writeUInt16LE(c.method, 10)
  rec.writeUInt16LE(dosTime, 12)
  rec.writeUInt16LE(dosDate, 14)
  rec.writeUInt32LE(c.e.crc, 16)
  rec.writeUInt32LE(c.payloadLen, 20)
  rec.writeUInt32LE(c.e.data.length, 24)
  rec.writeUInt16LE(c.name.length, 28)
  rec.writeUInt16LE(0, 30) // extra
  rec.writeUInt16LE(0, 32) // comment
  rec.writeUInt16LE(0, 34) // disk
  rec.writeUInt16LE(0, 36) // internal attrs
  rec.writeUInt32LE(0, 38) // external attrs
  rec.writeUInt32LE(c.offset, 42)
  chunks.push(rec, c.name)
  centralSize += rec.length + c.name.length
}

const eocd = Buffer.alloc(22)
eocd.writeUInt32LE(0x06054b50, 0)
eocd.writeUInt16LE(0, 4)
eocd.writeUInt16LE(0, 6)
eocd.writeUInt16LE(entries.length, 8)
eocd.writeUInt16LE(entries.length, 10)
eocd.writeUInt32LE(centralSize, 12)
eocd.writeUInt32LE(centralStart, 16)
eocd.writeUInt16LE(0, 20)
chunks.push(eocd)

await new Promise((resolveWrite, reject) => {
  const ws = createWriteStream(OUT)
  ws.on('error', reject)
  ws.on('finish', resolveWrite)
  for (const chunk of chunks) ws.write(chunk)
  ws.end()
})

const totalBytes = entries.reduce((n, e) => n + e.data.length, 0)
console.log(`hueforge-web-deploy-v${VERSION}.zip: ${entries.length} files, ${Math.round(totalBytes / 1024)} kB raw`)
