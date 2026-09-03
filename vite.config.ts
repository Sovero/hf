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

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [securityHeaders()],
  server: {
    host: '127.0.0.1',
  },
  test: {
    environment: 'node',
  },
})