import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** The page's Content-Security-Policy as `directive -> source tokens`. */
function policy(): Map<string, string[]> {
  const html = readFileSync(join(root, 'index.html'), 'utf8')
  const content = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1]
  if (!content) throw new Error('index.html has no Content-Security-Policy meta tag')
  const map = new Map<string, string[]>()
  for (const part of content.split(';')) {
    const [name, ...tokens] = part.trim().split(/\s+/)
    if (name) map.set(name, tokens)
  }
  return map
}

describe('the picture never leaves the computer', () => {
  const csp = policy()

  it('only lets the page talk to its own origin (and the local dev socket)', () => {
    const connect = csp.get('connect-src') ?? []
    for (const token of connect) {
      expect(["'self'", 'ws://127.0.0.1:*', 'ws://localhost:*'], `connect-src allows ${token}`).toContain(token)
    }
    expect(csp.get('default-src')).toEqual(["'self'"])
  })

  it('allows no eval and no remote script or worker sources', () => {
    for (const directive of ['script-src', 'worker-src', 'default-src']) {
      for (const token of csp.get(directive) ?? []) {
        expect(token, `${directive} allows ${token}`).not.toMatch(/^(https?:|\*$)/)
        expect(token, `${directive} allows ${token}`).not.toBe("'unsafe-eval'")
      }
    }
  })
})

/** Every file under `dir` (recursively) whose name matches. */
function files(dir: string, match: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path, match) : match.test(name) ? [path] : []
  })
}

describe('the depth code makes no outside requests', () => {
  it('carries no http(s) URL — the model and the runtime ship inside the build', () => {
    const sources = [
      ...files(join(root, 'src/lib/depth'), /\.ts$/),
      join(root, 'src/ui/depthClient.ts'),
      join(root, 'src/ui/depthResources.ts'),
      join(root, 'src/ui/depthRelief.ts'),
      join(root, 'src/worker/depth.worker.ts'),
    ]
    for (const file of sources) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/https?:\/\//)
    }
  })
})
