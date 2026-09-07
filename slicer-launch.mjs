/**
 * Opt-in "Open in slicer" endpoint shared by the deploy server (server.mjs)
 * and the Vite dev server.
 *
 * The browser POSTs the exported 3MF to /api/slicer/open; this module writes
 * it to a temp file and launches the user's slicer with it. Security model:
 *
 * - OFF by default. The caller enables it (`--allow-slicer` flag or
 *   HF_ALLOW_SLICER=1); without it every open request is refused with 403.
 * - The server binds to 127.0.0.1 only (static files) — nothing is exposed
 *   to the network.
 * - Cross-site requests are refused twice over: the POST must carry the
 *   custom `x-hueforge` header (a browser can only set it after a CORS
 *   preflight, which this server never grants), and the Origin header, when
 *   present, must match the server's own host.
 * - The slicer executable is never taken from the request — the client can
 *   only pick among paths discovered on this machine (or the HF_SLICER_PATH
 *   override set by the user who started the server).
 *
 * Slicer discovery: well-known install locations of Bambu Studio, OrcaSlicer
 * and PrusaSlicer on Windows/macOS/Linux. HF_SLICER_PATH overrides it —
 * either a plain executable path or a JSON array `["exe","arg1",…]` whose
 * arguments are passed before the model file (handy for wrappers and tests).
 */
import { spawn } from 'node:child_process'
import { accessSync, constants as fsConstants, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

/** Upper bound for an uploaded model (the largest relief STL/3MF is ~10 MB). */
export const MAX_BODY_BYTES = 256 * 1024 * 1024

/** Custom header the open request must carry (forces a CORS preflight). */
const REQUIRED_HEADER = 'x-hueforge'

const TMP_PREFIX = 'hueforge-open-'
const STALE_MS = 24 * 60 * 60 * 1000

/** A slicer found on this machine. `args` are passed before the model file. */
// ---- discovery ------------------------------------------------------------

function isFile(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function canExecute(p) {
  try {
    accessSync(p, fsConstants.X_OK)
  } catch {
    return false
  }
  return isFile(p)
}

function findExe(dir, match) {
  try {
    for (const entry of readdirSync(dir)) {
      if (!match.test(entry)) continue
      const p = join(dir, entry)
      if (canExecute(p)) return p
    }
  } catch {
    /* directory missing */
  }
  return null
}

/** Scan a directory and its one-level subdirectories (installer version folders). */
function findExeDeep(dir, match) {
  const direct = findExe(dir, match)
  if (direct) return direct
  try {
    const subs = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(dir, e.name))
      .sort((a, b) => b.localeCompare(a)) // newest version folder first
    for (const sub of subs) {
      const p = findExe(sub, match)
      if (p) return p
    }
  } catch {
    /* directory missing */
  }
  return null
}

function parseCustomPath(raw) {
  if (!raw) return []
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed)
      if (Array.isArray(arr) && arr.length && canExecute(String(arr[0]))) {
        return [{ id: 'custom', name: basename(String(arr[0])), path: String(arr[0]), args: arr.slice(1).map(String) }]
      }
    } catch {
      /* malformed JSON — treat as unset */
    }
    return []
  }
  return canExecute(trimmed) ? [{ id: 'custom', name: basename(trimmed), path: trimmed, args: [] }] : []
}

function windowsSlicers(env) {
  const pf = env.ProgramFiles ?? 'C:\\Program Files'
  const pf86 = env['ProgramFiles(x86)'] ?? pf
  const lad = env.LOCALAPPDATA ?? join(env.USERPROFILE ?? '', 'AppData', 'Local')
  const out = []
  const defs = [
    {
      id: 'bambu',
      name: 'Bambu Studio',
      exe: /^bambu[- ]?studio(\.exe)?$/i,
      fallback: /^bambu.*\.exe$/i,
      dirs: [join(pf, 'Bambu Studio'), join(pf86, 'Bambu Studio'), join(lad, 'Programs', 'Bambu Studio')],
    },
    {
      id: 'orca',
      name: 'OrcaSlicer',
      exe: /^orca[- ]?slicer(\.exe)?$/i,
      fallback: /^orca.*\.exe$/i,
      dirs: [join(lad, 'Programs', 'OrcaSlicer'), join(pf, 'OrcaSlicer'), join(pf86, 'OrcaSlicer')],
    },
    {
      id: 'prusa',
      name: 'PrusaSlicer',
      exe: /^prusa[- ]?slicer(\.exe)?$/i,
      fallback: null,
      dirs: [join(pf, 'Prusa3D'), join(pf86, 'Prusa3D'), join(lad, 'Programs', 'PrusaSlicer')],
    },
  ]
  for (const def of defs) {
    for (const dir of def.dirs) {
      const p = findExeDeep(dir, def.exe) ?? (def.fallback ? findExeDeep(dir, def.fallback) : null)
      if (p) {
        out.push({ id: def.id, name: def.name, path: p, args: [] })
        break
      }
    }
  }
  return out
}

function macSlicers() {
  const defs = [
    { id: 'bambu', name: 'Bambu Studio', p: '/Applications/BambuStudio.app/Contents/MacOS/BambuStudio' },
    { id: 'orca', name: 'OrcaSlicer', p: '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer' },
    { id: 'prusa', name: 'PrusaSlicer', p: '/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer' },
  ]
  return defs.filter((d) => canExecute(d.p)).map(({ id, name, p }) => ({ id, name, path: p, args: [] }))
}

function linuxSlicers(env) {
  const names = {
    bambu: ['bambu-studio'],
    orca: ['orca-slicer', 'OrcaSlicer'],
    prusa: ['prusa-slicer', 'prusa-slicer-console'],
  }
  const dirs = (env.PATH ?? '').split(':').filter(Boolean)
  const out = []
  for (const [id, list] of Object.entries(names)) {
    for (const dir of dirs) {
      for (const name of list) {
        const p = join(dir, name)
        if (canExecute(p)) {
          out.push({ id, name: id === 'bambu' ? 'Bambu Studio' : id === 'orca' ? 'OrcaSlicer' : 'PrusaSlicer', path: p, args: [] })
          break
        }
      }
    }
  }
  return out
}

/**
 * Slicers available on this machine, preferred order: Bambu Studio (the 3MF
 * is its native project format), OrcaSlicer, PrusaSlicer. HF_SLICER_PATH —
 * a plain path or a JSON array `["exe","arg1",…]` — replaces the discovery.
 */
export function discoverSlicers(env = process.env) {
  const custom = parseCustomPath(env.HF_SLICER_PATH)
  if (custom.length) return custom
  const out =
    process.platform === 'win32'
      ? windowsSlicers(env)
      : process.platform === 'darwin'
        ? macSlicers()
        : linuxSlicers(env)
  const seen = new Set()
  return out.filter((s) => {
    const key = s.path.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The slicer to launch for an open request: exact id, or the first found. */
export function pickSlicer(slicers, id) {
  if (!slicers.length) return null
  if (!id) return slicers[0]
  return slicers.find((s) => s.id === id) ?? null
}

/** Strip anything path-like or odd out of a client-supplied file name. */
export function sanitizeFileName(name) {
  const base = basename(String(name ?? ''))
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/^\.+/, '_')
  const safe = base || 'model.3mf'
  return safe.length > 100 ? safe.slice(-100) : safe
}

// ---- HTTP -----------------------------------------------------------------

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(payload))
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    // Trust-but-verify Content-Length first so an oversized upload is refused
    // before any of it is buffered.
    const declared = Number(req.headers['content-length'] ?? 0)
    if (declared > maxBytes) {
      reject(Object.assign(new Error('body too large'), { code: 'too-large' }))
      return
    }
    const chunks = []
    let size = 0
    let done = false
    const fail = (err) => {
      if (!done) {
        done = true
        req.pause()
        reject(err)
      }
    }
    req.on('data', (chunk) => {
      if (done) return // draining after a rejection
      size += chunk.length
      if (size > maxBytes) {
        fail(Object.assign(new Error('body too large'), { code: 'too-large' }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!done) {
        done = true
        resolve(Buffer.concat(chunks))
      }
    })
    req.on('error', fail)
  })
}

function launch(exePath, args, file) {
  const child = spawn(exePath, [...args, file], { detached: true, stdio: 'ignore' })
  child.on('error', () => {}) // discovery checked existence; late failures are the OS's to show
  child.unref()
}

/** Delete temp models older than a day (best effort) so tmp/ doesn't grow. */
function cleanupOldTempModels() {
  try {
    for (const entry of readdirSync(tmpdir())) {
      if (!entry.startsWith(TMP_PREFIX)) continue
      const p = join(tmpdir(), entry)
      try {
        if (Date.now() - statSync(p).mtimeMs > STALE_MS) rmSync(p, { force: true })
      } catch {
        /* in use or vanished */
      }
    }
  } catch {
    /* tmpdir unreadable */
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true // local tooling (curl & co.) sends no Origin
  const host = req.headers.host ?? ''
  return origin === `http://${host}` || origin === `https://${host}`
}

/**
 * Serve /api/slicer/*. Returns true when the request was handled; the caller
 * falls through to its own handling (static files / 404) otherwise.
 */
export async function handleSlicer(req, res, { enabled, maxBodyBytes = MAX_BODY_BYTES }) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!url.pathname.startsWith('/api/slicer')) return false

  if (req.method === 'OPTIONS') {
    // Preflight probe from a foreign origin: answer without CORS headers so
    // the browser blocks the follow-up request.
    res.writeHead(204, { 'Cache-Control': 'no-store' })
    res.end()
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/slicer/status') {
    json(res, 200, { enabled, slicers: enabled ? discoverSlicers() : [] })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/slicer/open') {
    if (!enabled) {
      json(res, 403, { error: 'disabled — start the server with --allow-slicer (or HF_ALLOW_SLICER=1)' })
      return true
    }
    if (!req.headers[REQUIRED_HEADER] || !sameOrigin(req)) {
      json(res, 403, { error: 'forbidden' })
      return true
    }
    const slicer = pickSlicer(discoverSlicers(), url.searchParams.get('slicer'))
    if (!slicer) {
      json(res, 400, { error: 'unknown-slicer', slicers: discoverSlicers() })
      return true
    }
    let body
    try {
      body = await readBody(req, maxBodyBytes)
    } catch (err) {
      if (err?.code === 'too-large') {
        req.resume() // drain the rest so the response flushes cleanly
        json(res, 413, { error: 'too-large' })
        return true
      }
      json(res, 400, { error: err?.code ?? 'body' })
      return true
    }
    const file = join(tmpdir(), `${TMP_PREFIX}${Date.now()}-${sanitizeFileName(url.searchParams.get('filename'))}`)
    writeFileSync(file, body)
    launch(slicer.path, slicer.args ?? [], file)
    cleanupOldTempModels()
    json(res, 200, { ok: true, slicer: slicer.name, file })
    return true
  }

  json(res, 404, { error: 'not-found' })
  return true
}
