import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { dict, t } from '../i18n'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * All data-help / data-i18n keys referenced by the static HTML — including the
 * attribute mappings (title, aria-label, placeholder, empty hint), because a
 * typo in any of them renders nothing at all and is easy to miss by eye.
 */
function htmlHelpKeys(): string[] {
  const html = readFileSync(join(here, '..', '..', 'index.html'), 'utf8')
  const keys = new Set<string>()
  for (const m of html.matchAll(/data-help="([^"]+)"/g)) keys.add(m[1])
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1])
  for (const attr of ['data-i18n-title', 'data-i18n-aria', 'data-i18n-placeholder', 'data-empty-i18n']) {
    for (const m of html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))) keys.add(m[1])
  }
  return [...keys]
}

describe('onboarding help coverage', () => {
  it('every data-help key in index.html exists in the dict in both languages', () => {
    for (const key of htmlHelpKeys()) {
      const entry = dict[key]
      expect(entry, `missing dict key: ${key}`).toBeTruthy()
      expect(entry.en.length, `${key}.en is empty`).toBeGreaterThan(0)
      expect(entry.ru.length, `${key}.ru is empty`).toBeGreaterThan(0)
    }
  })

  it('every section panel has a hint button with a help key', () => {
    const html = readFileSync(join(here, '..', '..', 'index.html'), 'utf8')
    const panels = html.match(/<section class="panel">/g)?.length ?? 0
    const hints = html.match(/class="hint-btn"/g)?.length ?? 0
    expect(panels).toBeGreaterThan(0)
    // The Colors panel hosts two sub-sections (2 · Colors and 3 · Depth mode),
    // each with its own hint — so hints ≥ panels, not strictly equal.
    expect(hints).toBeGreaterThanOrEqual(panels)
  })

  it('help texts resolve to non-empty strings in both languages', () => {
    for (const key of htmlHelpKeys()) {
      if (!key.startsWith('help')) continue
      expect(t('en', key).length).toBeGreaterThan(10)
      expect(t('ru', key).length).toBeGreaterThan(10)
    }
  })
})
