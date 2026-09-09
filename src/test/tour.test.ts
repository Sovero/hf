import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { dict } from '../i18n'
import { TOUR_ICONS, TOUR_STEPS } from '../ui/tour'

const here = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(join(here, '..', '..', 'index.html'), 'utf8')

describe('guided tour', () => {
  it('every tour step title/text key exists in the dict in both languages', () => {
    for (const step of TOUR_STEPS) {
      for (const key of [step.titleKey, step.textKey]) {
        const entry = dict[key]
        expect(entry, `missing dict key: ${key}`).toBeTruthy()
        expect(entry.en.length, `${key}.en is empty`).toBeGreaterThan(0)
        expect(entry.ru.length, `${key}.ru is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('every spotlight target exists in index.html', () => {
    for (const step of TOUR_STEPS) {
      if (!step.target) continue
      const sel = step.target
      if (sel.startsWith('#')) {
        // id="img-details" — the '#' prefix is selector syntax, not part of the id.
        expect(html.includes(`id="${sel.slice(1)}"`), `missing tour target ${sel}`).toBe(true)
      } else if (sel.startsWith('.')) {
        expect(html.includes(`class="${sel.slice(1)}"`), `missing tour target ${sel}`).toBe(true)
      } else {
        expect(html.includes(sel), `missing tour target ${sel}`).toBe(true)
      }
    }
  })

  it('icon steps reference known pictograms and spotlight a real control', () => {
    const iconSteps = TOUR_STEPS.filter((s) => s.icons && s.icons.length > 0)
    expect(iconSteps.length, 'no tour step carries icons').toBeGreaterThan(0)
    for (const step of iconSteps) {
      expect(step.target, 'icon step without a target').toBeTruthy()
      for (const key of step.icons!) {
        expect(TOUR_ICONS[key], `unknown tour icon: ${key}`).toBeTruthy()
      }
    }
    // The viewer-mode and light-toggle steps mirror the buttons' pictograms.
    const light = TOUR_STEPS.find((s) => s.target === '.light-toggle')
    const modes = TOUR_STEPS.find((s) => s.target === '#viewer3d-modes')
    expect(light?.icons).toEqual(['front', 'back'])
    expect(modes?.icons).toEqual(['model', 'deltae', 'slice'])
  })

  it('interactive steps have a target and hint keys exist in the dict', () => {
    const interactive = TOUR_STEPS.filter((s) => s.interactive)
    expect(interactive.length).toBeGreaterThan(0)
    for (const step of interactive) {
      expect(step.target, 'interactive step without a target').toBeTruthy()
    }
    for (const key of ['tourInteractHint', 'tourInteracted', 'tourChanged']) {
      const entry = dict[key]
      expect(entry, `missing dict key: ${key}`).toBeTruthy()
      expect(entry.en.length, `${key}.en is empty`).toBeGreaterThan(0)
      expect(entry.ru.length, `${key}.ru is empty`).toBeGreaterThan(0)
    }
  })

  it('mixes centered intro/outro cards with spotlight steps', () => {
    expect(TOUR_STEPS.length).toBeGreaterThan(1)
    expect(TOUR_STEPS.some((s) => s.target)).toBe(true)
    expect(TOUR_STEPS.some((s) => !s.target)).toBe(true)
    // A tour opens with an intro card and ends with an outro card.
    expect(TOUR_STEPS[0].target).toBeUndefined()
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].target).toBeUndefined()
  })
})