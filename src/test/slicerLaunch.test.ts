import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverSlicers, pickSlicer, sanitizeFileName, handleSlicer } from '../../slicer-launch.mjs'

/** Marker "slicer": a node script that proves it was launched with the model. */
const MARKER_SRC = "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.argv[2] + '.launched', 'ok')\n"

let fixtureDir: string
let server: Server
let port = 0
let savedEnv: string | undefined

beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'hf-slicer-test-'))
  writeFileSync(join(fixtureDir, 'marker.mjs'), MARKER_SRC)
  writeFileSync(join(fixtureDir, 'fake-slicer.exe'), 'not really an exe')
  // Discovery requires the execute bit — a no-op on Windows, required on POSIX.
  chmodSync(join(fixtureDir, 'fake-slicer.exe'), 0o755)
  savedEnv = process.env.HF_SLICER_PATH

  server = createServer((req, res) => {
    void handleSlicer(req, res, { enabled: true, maxBodyBytes: 1 << 20 })
      .then((handled) => {
        if (!handled) res.writeHead(404).end('nope')
      })
      .catch(() => {
        res.writeHead(500).end()
      })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port
      resolve()
    })
  })
})

afterAll(() => {
  server.close()
  if (savedEnv === undefined) delete process.env.HF_SLICER_PATH
  else process.env.HF_SLICER_PATH = savedEnv
  rmSync(fixtureDir, { recursive: true, force: true })
})

function startAltServer(enabled: boolean): Promise<{ server: Server; port: number }> {
  const alt = createServer((req, res) => {
    void handleSlicer(req, res, { enabled }).then((handled) => {
      if (!handled) res.writeHead(404).end('nope')
    })
  })
  return new Promise((resolve) => {
    alt.listen(0, '127.0.0.1', () => resolve({ server: alt, port: (alt.address() as { port: number }).port }))
  })
}

async function waitFor(file: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(file)) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return existsSync(file)
}

describe('pure helpers', () => {
  it('sanitizeFileName strips traversal and odd characters', () => {
    expect(sanitizeFileName('../../../../evil.exe')).toBe('evil.exe')
    expect(sanitizeFileName('model (v2).3mf')).toBe('model _v2_.3mf')
    expect(sanitizeFileName('.hidden')).toBe('_hidden')
    expect(sanitizeFileName('')).toBe('model.3mf')
  })

  it('pickSlicer matches by id and defaults to the first', () => {
    const list = [
      { id: 'a', name: 'A', path: '/a' },
      { id: 'b', name: 'B', path: '/b' },
    ]
    expect(pickSlicer(list, null)?.id).toBe('a')
    expect(pickSlicer(list, 'b')?.id).toBe('b')
    expect(pickSlicer(list, 'zz')).toBeNull()
    expect(pickSlicer([], null)).toBeNull()
  })

  it('discoverSlicers honors a plain HF_SLICER_PATH override', () => {
    const list = discoverSlicers({ HF_SLICER_PATH: join(fixtureDir, 'fake-slicer.exe') })
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('custom')
    expect(list[0].path).toBe(join(fixtureDir, 'fake-slicer.exe'))
  })

  it('discoverSlicers honors a JSON array override with launch args', () => {
    const list = discoverSlicers({
      HF_SLICER_PATH: JSON.stringify([process.execPath, join(fixtureDir, 'marker.mjs')]),
    })
    expect(list).toHaveLength(1)
    expect(list[0].path).toBe(process.execPath)
    expect(list[0].args).toEqual([join(fixtureDir, 'marker.mjs')])
  })
})

describe('POST /api/slicer/open', () => {
  it('is refused while disabled (403), with status still reporting it', async () => {
    const alt = await startAltServer(false)
    try {
      const status = await fetch(`http://127.0.0.1:${alt.port}/api/slicer/status`)
      expect(await status.json()).toMatchObject({ enabled: false, slicers: [] })

      const res = await fetch(`http://127.0.0.1:${alt.port}/api/slicer/open?slicer=custom&filename=m.3mf`, {
        method: 'POST',
        headers: { 'X-HueForge': '1' },
        body: Buffer.from('x'),
      })
      expect(res.status).toBe(403)
    } finally {
      alt.server.close()
    }
  })

  it('refuses requests without the custom header or with a foreign Origin', async () => {
    const base = `http://127.0.0.1:${port}`
    const body = Buffer.from('model bytes')

    const noHeader = await fetch(`${base}/api/slicer/open?slicer=custom&filename=m.3mf`, { method: 'POST', body })
    expect(noHeader.status).toBe(403)

    const foreign = await fetch(`${base}/api/slicer/open?slicer=custom&filename=m.3mf`, {
      method: 'POST',
      headers: { 'X-HueForge': '1', Origin: 'http://evil.example' },
      body,
    })
    expect(foreign.status).toBe(403)
  })

  it('rejects an unknown slicer id with the discovered list', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/slicer/open?slicer=ghost&filename=m.3mf`, {
      method: 'POST',
      headers: { 'X-HueForge': '1' },
      body: Buffer.from('x'),
    })
    expect(res.status).toBe(400)
    const data = (await res.json()) as { error?: string }
    expect(data.error).toBe('unknown-slicer')
  })

  it('writes the model to a temp file and launches the slicer with it', async () => {
    process.env.HF_SLICER_PATH = JSON.stringify([process.execPath, join(fixtureDir, 'marker.mjs')])

    // A stale temp model from "yesterday" must be cleaned up by the next open.
    const stale = join(tmpdir(), 'hueforge-open-stale-test.3mf')
    writeFileSync(stale, 'stale')
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000)
    utimesSync(stale, yesterday, yesterday)

    const model = Buffer.from('PK\x03\x04 fake 3mf payload')
    const res = await fetch(`http://127.0.0.1:${port}/api/slicer/open?slicer=custom&filename=model.3mf`, {
      method: 'POST',
      headers: { 'X-HueForge': '1' },
      body: model,
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { ok?: boolean; slicer?: string; file?: string }
    expect(data.ok).toBe(true)
    expect(data.file).toBeTruthy()

    // The exact bytes landed in the temp file…
    expect(readFileSync(data.file!)).toEqual(model)
    // …and the "slicer" was launched with that path (marker proves it).
    expect(await waitFor(`${data.file}.launched`)).toBe(true)

    // Cleanup removed the stale temp model (but not the fresh one).
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(data.file!)).toBe(true)
    rmSync(data.file!, { force: true })
  })

  it('rejects oversized bodies with 413', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/slicer/open?slicer=custom&filename=big.3mf`, {
      method: 'POST',
      headers: { 'X-HueForge': '1' },
      body: Buffer.alloc(2 << 20), // 2 MB > 1 MB test cap
    })
    expect(res.status).toBe(413)
  })
})
