import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import pkg from './package.json'

/**
 * Applies hardening headers to every response from the Vite dev/preview
 * servers. CSP itself is delivered via the <meta> tag in index.html so it
 * also applies to the built app on any static host.
 */
function securityHeaders(): Plugin {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  }
  const apply = (server: { middlewares: { use: (fn: (req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void) => void } }) => {
    server.middlewares.use((_req, res, next) => {
      for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
      next()
    })
  }
  return {
    name: 'security-headers',
    configureServer: apply,
    configurePreviewServer: apply,
  }
}

/**
 * Opt-in "Open in slicer" hand-off for the dev/preview servers. Off unless
 * HF_ALLOW_SLICER=1 — the production deploy server has the same endpoint
 * behind its own --allow-slicer flag (shared logic in slicer-launch.mjs).
 */
function slicerApi(): Plugin {
  const enabled = process.env.HF_ALLOW_SLICER === '1'
  const mount = (server: {
    middlewares: { use: (fn: (req: unknown, res: unknown, next: () => void) => void) => void }
  }) => {
    server.middlewares.use((req, res, next) => {
      const url = (req as { url?: string }).url ?? ''
      if (!url.startsWith('/api/slicer')) {
        next()
        return
      }
      void import('./slicer-launch.mjs')
        .then(({ handleSlicer }) =>
          handleSlicer(req as import('node:http').IncomingMessage, res as import('node:http').ServerResponse, { enabled }),
        )
        .then((handled) => {
          if (!handled) next()
        })
        .catch(() => next())
    })
  }
  return { name: 'open-in-slicer', configureServer: mount, configurePreviewServer: mount }
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [securityHeaders(), slicerApi()],
  server: {
    host: '127.0.0.1',
  },
  test: {
    environment: 'node',
  },
})