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

export interface TourStep {
  /** CSS selector of the element to spotlight. Omit for a centered card. */
  target?: string
  titleKey: string
  textKey: string
  /**
   * Hands-on step: Next stays disabled until the user actually uses the
   * control (e.g. drags the colors slider). Only meaningful with a target.
   */
  interactive?: boolean
}

export interface TourCallbacks {
  /** Localized string resolver, e.g. main.ts's `tr`. */
  tr: (key: string, params?: Record<string, string | number>) => string
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

    // Hands-on hint: tells the user to try the control, flips to a green ✓
    // once they did. The input listener unlocks Next exactly once.
    let hint: HTMLElement | null = null
    if (step.interactive && step.target) {
      const control = document.querySelector<HTMLElement>(step.target)
      if (control) {
        const prev = interactListeners.get(i)
        if (prev) control.removeEventListener('input', prev)
        const onChange = () => {
          if (stopped || interacted.has(i)) return
          interacted.add(i)
          render(i)
        }
        interactListeners.set(i, onChange)
        control.addEventListener('input', onChange)
        hint = document.createElement('p')
        hint.className = stepDone ? 'tour-interact ok' : 'tour-interact'
        hint.textContent = stepDone ? cb.tr('tourInteracted') : cb.tr('tourInteractHint')
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

    card.replaceChildren(title, text, dots, ...(hint ? [hint] : []), actions)

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