/**
 * HueForge Web — zero-dependency static server for the production build.
 *
 * Serves ./dist (created by `npm run build`) with the same hardening headers
 * as the Vite dev server. Needs nothing but Node.js — no npm install, no
 * node_modules — which makes it the deployment target for non-technical PCs:
 * unzip the deploy package and run deploy.bat.
 *
 * Usage: node server.mjs [port]   (default 8080, bound to 127.0.0.1)
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = resolve(fileURLToPath(new URL('./dist', import.meta.url)))
const HOST = '127.0.0.1'
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// Mirror vite.config.ts securityHeaders() so a standalone deployment is
// hardened exactly like the dev/preview servers (CSP rides in index.html).
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

if (!existsSync(DIST)) {
  console.error(`dist/ not found at ${DIST}. Run "npm run build" first.`)
  process.exit(1)
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`)
  // Decode + normalize; reject anything escaping the dist root.
  let pathname = decodeURIComponent(url.pathname)
  let filePath = resolve(join(DIST, normalize(pathname).replace(/^([/\\])+/, '')))
  if (filePath !== DIST && !filePath.startsWith(DIST + sep)) {
    res.writeHead(403, HEADERS).end('Forbidden')
    return
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // Single-page app: unknown paths fall back to index.html.
    filePath = join(DIST, 'index.html')
  }

  const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  // Hashed asset filenames are safe to cache forever; index.html must revalidate.
  const immutable = filePath.includes(`${sep}assets${sep}`)
  for (const [name, value] of Object.entries(HEADERS)) res.setHeader(name, value)
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')

  createReadStream(filePath)
    .on('error', () => res.writeHead(404, HEADERS).end('Not found'))
    .pipe(res)
})

server.listen(PORT, HOST, () => {
  console.log(`HueForge Web (production) at http://${HOST}:${PORT}`)
  console.log('Close this window or press Ctrl+C to stop the server.')
})
