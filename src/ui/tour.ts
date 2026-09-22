/**
 * Guided tour: a spotlight overlay that walks the user through the app's
 * sections one at a time. The target element is highlighted (everything else
 * is dimmed) and a card shows the section title, its explanation and
 * Skip / Back / Next buttons. Steps without a `target` render as centered
 * intro/outro cards.
 *
 * The engine is DOM-only at runtime; the step table (TOUR_STEPS) is pure data
 * so tests can validate it in a Node environment.
 */

import type { WordKey } from '../i18n'

export interface TourStep {
  /** CSS selector of the element to spotlight. Omit for a centered card. */
  target?: string
  titleKey: string
  textKey: string
  /**
   * Icon chips shown above the card title — the same pictograms the
   * spotlighted buttons carry. Keys resolve against TOUR_ICONS.
   */
  icons?: TourIconKey[]
  /**
   * Hands-on step: Next stays disabled until the user actually uses the
   * control (e.g. drags the colors slider). Only meaningful with a target.
   */
  interactive?: boolean
}

/** Icon keys shared with the viewer mode / light toggle buttons. */
export type TourIconKey = 'model' | 'deltae' | 'slice' | 'front' | 'back'

/**
 * The same stroke pictograms the buttons render (see index.html), so the
 * tour card shows exactly what the user will find on the control.
 */
export const TOUR_ICONS: Record<TourIconKey, string> = {
  model:
    '<svg class="tour-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.6 14 4.8v6.4L8 14.4 2 11.2V4.8Z"/><path d="M2 4.8 8 8l6-3.2M8 8v6.4"/></svg>',
  deltae:
    '<svg class="tour-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 2h5v5H2Z"/><path d="M9 2h5v5H9Z"/><path d="M2 9h5v5H2Z"/><path d="M9 9h5v5H9Z"/><path fill="currentColor" stroke="none" d="M9.5 9.5h4v4h-4Z"/></svg>',
  slice:
    '<svg class="tour-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.6 14 4.8v6.4L8 14.4 2 11.2V4.8Z"/><path d="M2 4.8 8 8l6-3.2M8 8v6.4"/><path d="M2 9.6h12"/></svg>',
  front:
    '<svg class="tour-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2.4"/><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1"/></svg>',
  back:
    '<svg class="tour-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="4" cy="8" r="1.8"/><path d="M4 3.4V1.8M4 12.6v1.6M.8 8h1.6M7.2 8h1.6M1.7 3.7l1 1M6.3 11.3l1 1M6.3 3.7l-1 1M1.7 11.3l1 1"/><path d="M10 2.5v11M12.2 2.5v11M14.4 2.5v11"/></svg>',
}

export interface TourCallbacks {
  /** Localized string resolver, e.g. main.ts's `tr`. */
  tr: (key: string, params?: Record<string, string | number>) => string
  /** Pluralized count, e.g. "2 параметра" — for the live status line. */
  plural: (n: number, wordKey: WordKey) => string
  /**
   * Called before a step renders: the target may live inside a collapsed
   * container (e.g. a sidebar tab panel), and the host app is responsible
   * for revealing it so the spotlight can measure and scroll to it.
   */
  revealTarget?: (target: HTMLElement) => void
  onFinish?: () => void
  onSkip?: () => void
}

/**
 * App sections and individual controls in walk-through order. Section steps
 * spotlight the whole panel; control steps zoom into a single input (colors
 * slider, dithering, each size field) and show a pulsing focus dot on it.
 * Text keys reuse the existing per-control tooltips from the dict.
 */
export const TOUR_STEPS: TourStep[] = [
  { titleKey: 'tourIntroTitle', textKey: 'tourIntro' },
  { target: '#img-details', titleKey: 'panelImage', textKey: 'helpImage' },
  { target: '#colors-details', titleKey: 'panelColors', textKey: 'helpColors' },
  { target: '#colors-slider', titleKey: 'sliderAria', textKey: 'helpColorsSlider', interactive: true },
  { target: '#dither-slider', titleKey: 'tourDitherTitle', textKey: 'helpDither' },
  { target: '#smooth-slider', titleKey: 'tourSmoothTitle', textKey: 'helpSmooth' },
  { target: '#depth-details', titleKey: 'panelDepth', textKey: 'helpDepth' },
  { target: '#size-details', titleKey: 'panelSize', textKey: 'helpSize' },
  { target: '#width-mm', titleKey: 'tourWidthTitle', textKey: 'helpWidth' },
  { target: '#height-mm', titleKey: 'tourHeightTitle', textKey: 'helpHeight' },
  { target: '#base-mm', titleKey: 'tourBaseTitle', textKey: 'helpBase' },
  { target: '#max-mm', titleKey: 'tourMaxTitle', textKey: 'helpMax' },
  { target: '#layer-mm', titleKey: 'tourLayerTitle', textKey: 'helpLayerMm' },
  { target: '#palette-details', titleKey: 'panelPalette', textKey: 'helpPalette' },
  { target: '#pb-details', titleKey: 'panelPrintability', textKey: 'helpPrintability' },
  { target: '#export-details', titleKey: 'panelExport', textKey: 'helpExport' },
  {
    target: '.light-toggle',
    titleKey: 'tourLightTitle',
    textKey: 'helpLightToggle',
    icons: ['front', 'back'],
  },
  {
    target: '#viewer3d-modes',
    titleKey: 'tourModesTitle',
    textKey: 'helpViewer3dModes',
    icons: ['model', 'deltae', 'slice'],
  },
  { titleKey: 'tourDoneTitle', textKey: 'tourDone' },
]

const SPOT_PAD = 6
const CARD_MARGIN = 14

/**
 * Starts the tour and returns a stop function (idempotent — calling it twice
 * is a no-op). The tour ends on the last step's Next/Finish, on Skip, or via
 * Escape; `onFinish`/`onSkip` fire once in those cases.
 */
export function startTour(steps: TourStep[], cb: TourCallbacks): () => void {
  let index = 0
  let stopped = false
  /** Step indexes the user already interacted with (survives re-renders). */
  const interacted = new Set<number>()
  /** Attached input listeners per step, so re-renders don't stack them. */
  const interactListeners = new Map<number, () => void>()
  /** Initial control value per interactive step, captured on first render. */
  const initialValues = new Map<number, string>()

  /** How many interactive steps currently hold a value different from the
   *  one they had when their step was first shown. */
  const changedCount = () => {
    let n = 0
    for (const i of interacted) {
      const step = steps[i]
      if (!step.interactive || !step.target) continue
      const control = document.querySelector<HTMLInputElement>(step.target)
      if (control && control.value !== initialValues.get(i)) n++
    }
    return n
  }

  const overlay = document.createElement('div')
  overlay.className = 'tour-overlay'
  const spotlight = document.createElement('div')
  spotlight.className = 'tour-spotlight'
  const focusDot = document.createElement('div')
  focusDot.className = 'tour-focus'
  const card = document.createElement('div')
  card.className = 'tour-card'
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  card.tabIndex = -1
  overlay.append(spotlight, focusDot, card)
  document.body.appendChild(overlay)
  document.body.style.overflow = 'hidden'

  const stop = () => {
    if (stopped) return
    stopped = true
    for (const [i, fn] of interactListeners) {
      const step = steps[i]
      if (step.target) document.querySelector(step.target)?.removeEventListener('input', fn)
    }
    interactListeners.clear()
    overlay.remove()
    document.body.style.overflow = ''
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', onResize)
  }

  const next = () => {
    if (index < steps.length - 1) {
      index++
      render(index)
    } else {
      stop()
      cb.onFinish?.()
    }
  }

  const prev = () => {
    if (index > 0) {
      index--
      render(index)
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      stop()
      cb.onSkip?.()
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      // On an interactive step, arrows belong to the focused control
      // (e.g. the colors slider), not to tour navigation.
      const step = steps[index]
      if (step.interactive && step.target) {
        const control = document.querySelector<HTMLElement>(step.target)
        if (control && document.activeElement === control) return
      }
      if (e.key === 'ArrowRight') next()
      else prev()
    }
  }

  const onResize = () => {
    if (!stopped) render(index)
  }

  const button = (label: string, className: string, onClick: () => void, disabled = false) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = className
    b.textContent = label
    b.disabled = disabled
    b.addEventListener('click', onClick)
    return b
  }

  function render(i: number) {
    const step = steps[i]
    const target = step.target ? document.querySelector<HTMLElement>(step.target) : null
    // A missing target (defensive) skips forward rather than wedging the tour.
    if (step.target && !target) {
      next()
      return
    }

    spotlight.hidden = !target
    focusDot.hidden = !target
    if (target) {
      cb.revealTarget?.(target)
      target.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = target.getBoundingClientRect()
      spotlight.style.left = `${r.left - SPOT_PAD}px`
      spotlight.style.top = `${r.top - SPOT_PAD}px`
      spotlight.style.width = `${r.width + SPOT_PAD * 2}px`
      spotlight.style.height = `${r.height + SPOT_PAD * 2}px`
      // Pulsing focus dot on the spotlight's top-right corner.
      const s = spotlight.getBoundingClientRect()
      focusDot.style.left = `${s.right - 5}px`
      focusDot.style.top = `${s.top - 5}px`
    }

    const title = document.createElement('h3')
    title.textContent = cb.tr(step.titleKey)
    const text = document.createElement('p')
    text.textContent = cb.tr(step.textKey)

    // Icon chips mirroring the spotlighted control's button pictograms.
    const icons = document.createElement('div')
    icons.className = 'tour-icons'
    if (step.icons) {
      for (const key of step.icons) {
        const chip = document.createElement('span')
        chip.className = 'tour-icon-chip'
        chip.innerHTML = TOUR_ICONS[key]
        chip.setAttribute('role', 'img')
        icons.appendChild(chip)
      }
    } else {
      icons.hidden = true
    }

    const actions = document.createElement('div')
    actions.className = 'tour-actions'
    const progress = document.createElement('span')
    progress.className = 'tour-progress'
    progress.textContent = cb.tr('tourStep', { n: i + 1, total: steps.length })
    const skipBtn = button(cb.tr('tourSkip'), 'tour-btn ghost', () => {
      stop()
      cb.onSkip?.()
    })
    const prevBtn = button(cb.tr('tourPrev'), 'tour-btn', prev, i === 0)
    const stepDone = interacted.has(i)
    const nextBtn = button(
      i === steps.length - 1 ? cb.tr('tourFinish') : cb.tr('tourNext'),
      'tour-btn primary',
      next,
    )
    if (step.interactive) nextBtn.disabled = !stepDone
    actions.append(progress, skipBtn, prevBtn, nextBtn)

    // Hands-on hint + live status: invites the user to try the control,
    // flips to a green ✓ on first use, and shows a live before/after
    // comparison plus a running count of changed parameters.
    let hint: HTMLElement | null = null
    let live: HTMLElement | null = null
    if (step.interactive && step.target) {
      const control = document.querySelector<HTMLInputElement>(step.target)
      if (control) {
        if (!initialValues.has(i)) initialValues.set(i, control.value)
        const initVal = initialValues.get(i) ?? ''
        const prev = interactListeners.get(i)
        if (prev) control.removeEventListener('input', prev)

        hint = document.createElement('p')
        hint.className = stepDone ? 'tour-interact ok' : 'tour-interact'
        hint.textContent = stepDone ? cb.tr('tourInteracted') : cb.tr('tourInteractHint')

        const compare = document.createElement('span')
        compare.className = 'tour-compare'
        const status = document.createElement('span')
        status.className = 'tour-status'
        live = document.createElement('div')
        live.className = 'tour-live'
        live.append(compare, status)

        const refreshLive = () => {
          compare.textContent = `${initVal} → ${control.value}`
          compare.hidden = control.value === initVal
          const n = changedCount()
          status.textContent = n > 0 ? cb.tr('tourChanged', { params: cb.plural(n, 'params') }) : ''
          status.hidden = n === 0
        }

        const onChange = () => {
          if (stopped) return
          if (!interacted.has(i)) {
            interacted.add(i)
            hint!.className = 'tour-interact ok'
            hint!.textContent = cb.tr('tourInteracted')
            nextBtn.disabled = false
          }
          refreshLive()
        }
        interactListeners.set(i, onChange)
        control.addEventListener('input', onChange)
        refreshLive()
      }
    }

    // Clickable progress dots: one per step; the active one is a pill,
    // finished steps are dimmed accent dots. Clicking jumps to that step.
    const dots = document.createElement('div')
    dots.className = 'tour-dots'
    for (let d = 0; d < steps.length; d++) {
      const dot = document.createElement('button')
      dot.type = 'button'
      dot.className = d === i ? 'tour-dot active' : d < i ? 'tour-dot done' : 'tour-dot'
      dot.setAttribute('aria-label', cb.tr('tourStep', { n: d + 1, total: steps.length }))
      dot.addEventListener('click', () => {
        if (d !== index) {
          index = d
          render(index)
        }
      })
      dots.appendChild(dot)
    }

    card.replaceChildren(icons, title, text, dots, ...(hint ? [hint] : []), ...(live ? [live] : []), actions)

    // Center horizontally; below the spotlight when there is room, else above.
    card.style.left = '50%'
    card.style.transform = 'translateX(-50%)'
    if (target) {
      const r = spotlight.getBoundingClientRect()
      const cardH = card.offsetHeight
      const below = r.bottom + CARD_MARGIN
      const above = r.top - CARD_MARGIN - cardH
      card.style.top = below + cardH <= window.innerHeight ? `${below}px` : `${Math.max(CARD_MARGIN, above)}px`
    } else {
      card.style.top = '30%'
    }
    card.focus()
  }

  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
  render(0)
  return stop
}