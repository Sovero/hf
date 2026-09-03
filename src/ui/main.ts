import './styles.css'
import { runPipeline, exportStl, export3mfFile, exportFilename, type PipelineResult } from '../lib/pipeline'
import { analyzePrintability } from '../lib/printability'
import { rgbToHex, nearestFilament } from '../lib/palette'
import { Viewer3D } from './viewer3d'
import { t, word, loadLang, saveLang, hasLangPreference, dismissLangPrompt, type Lang } from '../i18n'

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector(sel)
  if (!el) throw new Error(`Missing element: ${sel}`)
  return el as T
}

let current: PipelineResult | null = null
let currentFile: File | null = null
let viewer3d: Viewer3D | null = null
/** Guards against overlapping runs writing stale results (live reprocessing). */
let runToken = 0
let lang: Lang = loadLang()
const tr = (key: string, params?: Record<string, string | number>) => t(lang, key, params)

const dropZone = $<HTMLDivElement>('#drop-zone')
const fileInput = $<HTMLInputElement>('#file-input')
const imageInfo = $<HTMLParagraphElement>('#image-info')
const paletteList = $<HTMLDivElement>('#palette-list')
const paletteSummary = $<HTMLParagraphElement>('#palette-summary')
const printabilityList = $<HTMLDivElement>('#printability-list')
const printabilitySummary = $<HTMLParagraphElement>('#printability-summary')
const exportStatus = $<HTMLParagraphElement>('#export-status')
const btnStl = $<HTMLButtonElement>('#btn-stl')
const btn3mf = $<HTMLButtonElement>('#btn-3mf')
const canvasSource = $<HTMLCanvasElement>('#canvas-source')
const canvasQuantized = $<HTMLCanvasElement>('#canvas-quantized')
const colorsSlider = $<HTMLInputElement>('#colors-slider')
const colorsValue = $<HTMLInputElement>('#colors-value')
const sliderTicks = $<HTMLDivElement>('#slider-ticks')

const SLIDER_MIN = 2
const SLIDER_MAX = 24
const PRESET_TICKS = [2, 4, 8, 12, 16, 24]
const widthInput = $<HTMLInputElement>('#width-mm')
const heightInput = $<HTMLInputElement>('#height-mm')
const baseInput = $<HTMLInputElement>('#base-mm')
const maxInput = $<HTMLInputElement>('#max-mm')
const viewerEl = $<HTMLDivElement>('#viewer3d')
const themeSelect = $<HTMLSelectElement>('#theme-select')
const langSelect = $<HTMLSelectElement>('#lang-select')
const langBanner = $<HTMLDivElement>('#lang-banner')
const bannerStart = $<HTMLButtonElement>('#banner-start')
const langBannerSkip = $<HTMLButtonElement>('#lang-banner-skip')
const langBannerBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.lang-banner-btn'))
const bannerThemeBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.banner-theme-btn'))
const processingOverlay = $<HTMLDivElement>('#processing-overlay')
const versionBadge = $<HTMLSpanElement>('#app-version')

function setProcessing(on: boolean) {
  processingOverlay.hidden = !on
  btnStl.disabled = on
  btn3mf.disabled = on
}

/** Set the color count, refresh the UI, and reprocess if an image is loaded. */
function applyCount(v: number) {
  const clamped = Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, Math.round(v) || SLIDER_MIN))
  colorsSlider.value = String(clamped)
  colorsValue.value = String(clamped)
  renderTicks()
  if (currentFile) void readFile(currentFile)
}

function readOptions() {
  // Clamp every numeric input to sane bounds: Number() can yield NaN/±Infinity
  // (e.g. "1e999", "abc"), which must never reach the geometry or exports.
  const clampNum = (v: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
  const numColors = clampNum(Math.round(Number(colorsSlider.value)), 2, 24, 4)
  const darkIsTall = document.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value !== 'light'
  const baseMm = clampNum(Number(baseInput.value), 0, 5, 0.8)
  const maxHeightMm = clampNum(Number(maxInput.value), baseMm + 2, 40, 8)
  return {
    numColors: numColors as 2 | 4 | 8 | 12 | 16 | 24,
    darkIsTall,
    widthMm: clampNum(Number(widthInput.value), 20, 500, 150),
    heightMm: clampNum(Number(heightInput.value), 20, 500, 150),
    baseMm,
    maxHeightMm,
  }
}

function showStatus(msg: string, isError = false) {
  exportStatus.textContent = msg
  exportStatus.style.color = isError ? 'var(--danger)' : 'var(--muted)'
}

async function readFile(file: File) {
  currentFile = file
  const token = ++runToken
  showStatus(tr('processing'))
  setProcessing(true)
  try {
    const result = await runPipeline(file, readOptions(), lang)
    if (token !== runToken) return // a newer run superseded this one; it owns the UI
    current = result
    updateUI()
    setProcessing(false)
    showStatus(tr('ready', { colors: word(lang, current.quantized.palette.length, 'colors') }))
  } catch (err) {
    if (token !== runToken) return
    setProcessing(false)
    current = null
    btnStl.disabled = true
    btn3mf.disabled = true
    printabilityList.innerHTML = ''
    printabilitySummary.textContent = tr('pbDefault')
    showStatus(err instanceof Error ? err.message : String(err), true)
  }
}

/** Write every [data-i18n] element (and aria-labels) in the current language. */
function applyStaticText() {
  document.documentElement.lang = lang
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n
    if (key) el.textContent = tr(key)
  }
  colorsSlider.ariaLabel = tr('sliderAria')
  colorsValue.ariaLabel = tr('sliderValueAria')
  renderTicks() // rebuild tick tooltips/labels in the current language
}

/**
 * Switch language and re-render everything user-visible. When `persist` is
 * true (top-bar switcher) the choice is saved; the first-run banner previews
 * without persisting so Start/Skip still own the outcome.
 */
function setLang(next: Lang, persist = true) {
  if (next === lang) return
  lang = next
  if (persist) saveLang(lang)
  langSelect.value = lang
  applyStaticText()
  if (current) {
    updateUI()
    showStatus(tr('ready', { colors: word(lang, current.quantized.palette.length, 'colors') }))
  }
}

/**
 * One-time first-run prompt: when no preference is stored yet, show a banner
 * where the user picks a language and a theme, then confirms with Start.
 * The chosen theme is applied live and persisted, so it survives relaunches.
 */
function setupLangPrompt() {
  if (hasLangPreference()) return

  let chosenLang: Lang = lang // detected language, preselected
  let chosenTheme = document.documentElement.dataset.theme ?? 'dark' // whatever is active

  const setPressed = (btns: HTMLButtonElement[], value: string) => {
    for (const b of btns) {
      b.setAttribute('aria-pressed', (b.dataset.lang ?? b.dataset.theme) === value ? 'true' : 'false')
    }
  }

  // Detected language first, then the other one. Clicking previews the UI
  // language immediately (banner copy flips live) without persisting yet.
  langBannerBtns.forEach((b) => {
    b.style.order = b.dataset.lang === lang ? '0' : '1'
    b.addEventListener('click', () => {
      const v = b.dataset.lang
      if (v === 'en' || v === 'ru') {
        chosenLang = v
        setPressed(langBannerBtns, v)
        if (v !== lang) setLang(v, false)
      }
    })
  })

  // Theme swatches: hover/focus peeks at the theme without persisting, click
  // commits it (applies live and saves). Leaving a swatch reverts the peek so
  // the banner always shows the committed theme again.
  const peekTheme = (theme: string) => applyTheme(theme, false)
  const peeked: HTMLButtonElement[] = []
  bannerThemeBtns.forEach((b) => {
    b.addEventListener('mouseenter', () => peekTheme(b.dataset.theme ?? ''))
    b.addEventListener('mouseleave', () => peekTheme(chosenTheme))
    b.addEventListener('focus', () => {
      peeked.push(b)
      peekTheme(b.dataset.theme ?? '')
    })
    b.addEventListener('blur', () => {
      const i = peeked.indexOf(b)
      if (i >= 0) peeked.splice(i, 1)
      if (peeked.length === 0) peekTheme(chosenTheme)
    })
    b.addEventListener('click', () => {
      const v = b.dataset.theme
      if (v) {
        chosenTheme = v
        peeked.length = 0
        setPressed(bannerThemeBtns, v)
        applyTheme(v) // persist
      }
    })
  })

  // Start persists the chosen language (even when it equals the detected one)
  // and the chosen theme, then dismisses the banner for good.
  bannerStart.addEventListener('click', () => {
    saveLang(chosenLang)
    if (chosenLang !== lang) setLang(chosenLang)
    applyTheme(chosenTheme)
    langBanner.hidden = true
  })
  langBannerSkip.addEventListener('click', () => {
    dismissLangPrompt()
    langBanner.hidden = true
  })

  setPressed(langBannerBtns, chosenLang)
  setPressed(bannerThemeBtns, chosenTheme)
  langBanner.hidden = false
  ;(langBanner.querySelector<HTMLButtonElement>(`.lang-banner-btn[data-lang="${lang}"]`) ?? langBannerBtns[0])?.focus()
}

function updateUI() {
  if (!current) return
  drawSource()
  drawQuantized()
  renderPalette()
  renderPrintability()
  update3d()
  btnStl.disabled = false
  btn3mf.disabled = false
  imageInfo.textContent = tr('processedAt', { w: current.image.width, h: current.image.height })
}

function renderPrintability() {
  const report = analyzePrintability(current!, lang)
  printabilityList.innerHTML = ''
  for (const check of report.checks) {
    const row = document.createElement('div')
    row.className = `check-row check-${check.level}`
    const icon = document.createElement('span')
    icon.className = 'check-icon'
    icon.textContent = check.level === 'fail' ? '✕' : check.level === 'warn' ? '⚠' : '✓'
    const body = document.createElement('div')
    const title = document.createElement('div')
    title.className = 'check-title'
    title.textContent = check.title
    const detail = document.createElement('div')
    detail.className = 'check-detail'
    detail.textContent = check.detail
    body.append(title, detail)
    row.append(icon, body)
    printabilityList.appendChild(row)
  }
  printabilitySummary.textContent =
    report.errors === 0 && report.warnings === 0
      ? tr('allPassed')
      : `${word(lang, report.errors, 'errors')} · ${word(lang, report.warnings, 'warnings')}`
}

function drawSource() {
  const { width, height, rgba } = current!.image
  canvasSource.width = width
  canvasSource.height = height
  canvasSource.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
}

function drawQuantized() {
  const { width, height, indexMap, palette } = current!.quantized
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const c = palette[indexMap[i]]
    rgba[i * 4] = c.r
    rgba[i * 4 + 1] = c.g
    rgba[i * 4 + 2] = c.b
    rgba[i * 4 + 3] = 255
  }
  canvasQuantized.width = width
  canvasQuantized.height = height
  canvasQuantized.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0)
}

function renderPalette() {
  const palette = current!.palette
  paletteList.innerHTML = ''
  for (const entry of palette) {
    const row = document.createElement('div')
    row.className = 'palette-row'
    const swatch = document.createElement('div')
    swatch.className = 'palette-swatch'
    swatch.style.background = rgbToHex(entry.color)
    const label = document.createElement('span')
    label.textContent = `#${entry.printOrder} · ${rgbToHex(entry.color)} · ~${nearestFilament(entry.color, lang)}`
    row.append(swatch, label)
    paletteList.appendChild(row)
  }
  paletteSummary.textContent = tr('paletteSummary', { colors: word(lang, palette.length, 'colors') })
}

function update3d() {
  viewer3d ??= new Viewer3D(viewerEl)
  viewer3d.setBackground(THEME_VIEWER_BG[document.documentElement.dataset.theme ?? 'dark'] ?? THEME_VIEWER_BG.dark)
  viewer3d.setMesh(current!.mesh)
}

function triggerDownload(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const THEME_VIEWER_BG: Record<string, string> = {
  dark: '#101418',
  light: '#e2e8ee',
  nord: '#2e3440',
  solar: '#ede5cf',
}

/**
 * Apply a theme. With `persist` false (hover peek) the look changes but
 * nothing is written to localStorage, so a glance never commits a theme.
 */
function applyTheme(theme: string, persist = true) {
  document.documentElement.dataset.theme = theme
  if (persist) {
    try { localStorage.setItem('hf-theme', theme) } catch { /* private mode */ }
  }
  themeSelect.value = theme
  viewer3d?.setBackground(THEME_VIEWER_BG[theme] ?? THEME_VIEWER_BG.dark)
}

function setupTheme() {
  const saved = (() => { try { return localStorage.getItem('hf-theme') } catch { return null } })()
  const initial = saved && THEME_VIEWER_BG[saved] ? saved : 'dark'
  themeSelect.value = initial
  applyTheme(initial)
  themeSelect.addEventListener('change', () => applyTheme(themeSelect.value))
}

function setupDropZone() {
  dropZone.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0]
    if (f) void readFile(f)
  })
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault()
    dropZone.classList.add('dragover')
  })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'))
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault()
    dropZone.classList.remove('dragover')
    const f = e.dataTransfer?.files?.[0]
    if (f) void readFile(f)
  })
}

function bindInputs() {
  for (const el of document.querySelectorAll<HTMLInputElement>(
    'input[name="mode"], #width-mm, #height-mm, #base-mm, #max-mm',
  )) {
    el.addEventListener('change', () => {
      if (currentFile) void readFile(currentFile)
    })
  }

  // Live reprocessing while dragging: debounced on input, flushed on release.
  let debounceTimer: number | undefined
  const scheduleReprocess = () => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(() => {
      debounceTimer = undefined
      if (currentFile) void readFile(currentFile)
    }, 250)
  }
  const flushReprocess = () => {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer)
      debounceTimer = undefined
    }
    if (currentFile) void readFile(currentFile)
  }
  colorsSlider.addEventListener('change', flushReprocess)
  colorsSlider.addEventListener('input', () => {
    colorsValue.value = colorsSlider.value
    renderTicks()
    scheduleReprocess()
  })

  // Manual entry: typing a count in the box applies it on change/blur.
  colorsValue.addEventListener('change', () => {
    if (colorsValue.value.trim() === '') {
      colorsValue.value = colorsSlider.value // cleared box → revert to current
      return
    }
    const raw = Number(colorsValue.value)
    if (!Number.isFinite(raw)) {
      colorsValue.value = colorsSlider.value
      return
    }
    applyCount(raw)
  })

  // Keyboard control: arrows step by 1, Home/End jump to the ends,
  // typing digits sets the count directly ("1" then "6" → 16).
  let digitBuffer = ''
  let digitTimer: number | undefined
  const flushDigits = () => {
    if (digitBuffer !== '') applyCount(Number(digitBuffer))
    digitBuffer = ''
    if (digitTimer !== undefined) clearTimeout(digitTimer)
    digitTimer = undefined
  }
  colorsSlider.addEventListener('keydown', (e) => {
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault()
      if (digitBuffer.length >= 2 || (digitBuffer === '' && e.key === '0')) return
      digitBuffer += e.key
      if (digitBuffer.length === 2) {
        flushDigits()
      } else if (digitTimer === undefined) {
        digitTimer = window.setTimeout(flushDigits, 600)
      }
      return
    }
    if (e.key === 'Enter') { e.preventDefault(); flushDigits(); return }
    if (e.key === 'Escape') {
      digitBuffer = ''
      if (digitTimer !== undefined) clearTimeout(digitTimer)
      digitTimer = undefined
      return
    }
    if (e.key === 'Home') { e.preventDefault(); applyCount(SLIDER_MIN); return }
    if (e.key === 'End') { e.preventDefault(); applyCount(SLIDER_MAX); return }
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); applyCount(Number(colorsSlider.value) + 1); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); applyCount(Number(colorsSlider.value) - 1); return }
  })
}

/** Draw tick marks at the preset positions, highlighting the current value. */
function renderTicks() {
  sliderTicks.innerHTML = ''
  const span = SLIDER_MAX - SLIDER_MIN
  const current = Number(colorsSlider.value)
  for (const v of PRESET_TICKS) {
    const tick = document.createElement('span')
    tick.className = 'slider-tick'
    tick.style.left = `${((v - SLIDER_MIN) / span) * 100}%`
    tick.title = word(lang, v, 'colors')
    if (v === current) tick.classList.add('active')
    tick.addEventListener('click', () => applyCount(v))
    const line = document.createElement('span')
    line.className = 'tick-line'
    const label = document.createElement('span')
    label.className = 'tick-label'
    label.textContent = String(v)
    tick.append(line, label)
    sliderTicks.appendChild(tick)
  }
}

function setupExports() {
  btnStl.addEventListener('click', () => {
    if (!current) return
    const filename = exportFilename(current, 'stl')
    triggerDownload(exportStl(current) as unknown as BlobPart, filename, 'model/stl')
    showStatus(tr('exportStlDone', { filename }))
  })
  btn3mf.addEventListener('click', () => {
    if (!current) return
    const filename = exportFilename(current, '3mf')
    triggerDownload(export3mfFile(current, filename.slice(0, -4)) as unknown as BlobPart, filename, 'model/3mf')
    showStatus(tr('export3mfDone', { filename }))
  })
}

versionBadge.textContent = `v${__APP_VERSION__}`

// Language: apply immediately (before first paint), bind the switcher.
langSelect.value = lang
langSelect.addEventListener('change', () => setLang(langSelect.value as Lang))
applyStaticText()
setupLangPrompt()

setupTheme()
setupDropZone()
bindInputs()
setupExports()
renderTicks()
