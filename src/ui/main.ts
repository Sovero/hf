import './styles.css'
import { exportStl, export3mfFile, exportFilename, type PipelineResult } from '../lib/pipeline'
import { loadImageForPrint } from '../lib/loadImage'
import { quantizeInWorker, rebuildInWorker, setResultListener } from './workerClient'
import type { WorkerResult } from '../lib/workerProtocol'
import { MATERIALS, LIBRARY, BRANDS, materialName, nearestLibraryFilament, findFilament, addCustomFilament, removeCustomFilament, restoreCustomFilament, customFilaments, isCustomId, CUSTOM_BRAND_ID, type LibraryChoice, type MaterialId, type CustomFilament } from '../lib/filamentLibrary'
import { buildProjectFile, parseProjectFile, ProjectFileError, PROJECT_EXTENSION, type ProjectFile, type ProjectSettings, type ProjectPaletteSlot } from '../lib/project'
import { describeExport } from '../lib/describe'
import { buildSlicerBundle } from '../lib/slicerBundle'
import { buildCalibrationSwatch, fitTau, CALIB_STEPS, type CalibSample } from '../lib/calibration'
import { DEFAULT_TAU_MM, backlitBandColors, transmittedBandColors } from '../lib/transmission'
import type { ColorCount, QuantizedImage } from '../lib/types'
import type { SlicerInfo } from '../../slicer-launch.mjs'
import { layerView } from '../lib/layerView'
import { fitPrintSizeToAspect } from '../lib/printConsts'
import { deltaE2000Rgb } from '../lib/deltae'
import { analyzePrintability, fixFor, type PrintabilityFix } from '../lib/printability'
import { createPerfStats } from '../lib/perfStats'
import { rgbToHex, hexToRgb, nearestFilament, luminance } from '../lib/palette'
import { parseReference3mf, Reference3mfParseError } from '../lib/reference3mf'
import { planReferenceApply, type ReferenceApplyPlan } from '../lib/referenceApply'
import type { Reference3mfAnalysis } from '../lib/reference3mf'
import type { RGB } from '../lib/types'
import { Viewer3D } from './viewer3d'
import type { FaceName } from '../lib/viewCubeMath'
import { autoPickFilaments } from '../lib/autoPick'
import { colorShares, formatShare } from '../lib/colorShare'
import { orderSpools } from '../lib/spoolOrder'
import { recentSpoolIds, recordRecentSpools } from '../lib/recentSpools'
import { shoppingList, unassignedCount, formatShoppingList } from '../lib/shoppingList'
import { PRINTERS, PRINTER_NONE, bedSizeFor } from '../lib/printers'
import { dropSparseColors, dropTargets } from '../lib/dropSparse'
import { startTour, TOUR_STEPS } from './tour'
import { t, word, mmOf, loadLang, saveLang, hasLangPreference, dismissLangPrompt, type Lang } from '../i18n'

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
/**
 * Bumped on every editor mutation that changes the quantized mirror; worker
 * rebuild responses captured with an older version are stale and ignored.
 */
let stateVersion = 0
let lang: Lang = loadLang()
const tr = (key: string, params?: Record<string, string | number>) => t(lang, key, params)

const dropZone = $<HTMLDivElement>('#drop-zone')
const fileInput = $<HTMLInputElement>('#file-input')
const imageInfo = $<HTMLParagraphElement>('#image-info')
const paletteList = $<HTMLDivElement>('#palette-list')
const paletteSummary = $<HTMLParagraphElement>('#palette-summary')
const paletteCoverage = $<HTMLDivElement>('#palette-coverage')
const paletteHeightsReset = $<HTMLButtonElement>('#palette-heights-reset')
const catalogBtn = $<HTMLButtonElement>('#catalog-pick')
const autoPickBtn = $<HTMLButtonElement>('#auto-pick')
const dropSparseBtn = $<HTMLButtonElement>('#palette-drop-sparse')
const dropSparseWrap = $<HTMLSpanElement>('#drop-sparse-wrap')
const dropSparseThreshold = $<HTMLInputElement>('#drop-sparse-threshold')
const dimsEl = $<HTMLParagraphElement>('#viewer3d-dims')
const printerSelect = $<HTMLSelectElement>('#printer-select')
const shoppingListBtn = $<HTMLButtonElement>('#btn-shopping-list')
const calibBlock = $<HTMLDivElement>('#calib')
const calibColor = $<HTMLSelectElement>('#calib-color')
const calibDownload = $<HTMLButtonElement>('#calib-download')
const calibPhoto = $<HTMLInputElement>('#calib-photo')
const calibCanvas = $<HTMLCanvasElement>('#calib-canvas')
const calibStatus = $<HTMLParagraphElement>('#calib-status')
const printabilityList = $<HTMLDivElement>('#printability-list')
const printabilitySummary = $<HTMLParagraphElement>('#printability-summary')
const pbBadge = $<HTMLSpanElement>('#pb-badge')
const exportStatus = $<HTMLParagraphElement>('#export-status')
const btnStl = $<HTMLButtonElement>('#btn-stl')
const btn3mf = $<HTMLButtonElement>('#btn-3mf')
const btnDescribe = $<HTMLButtonElement>('#btn-describe')
const btnSlicer = $<HTMLButtonElement>('#btn-slicer')
const openSlicerRow = $<HTMLDivElement>('#open-slicer-row')
const slicerSelect = $<HTMLSelectElement>('#slicer-select')
const btnOpenSlicer = $<HTMLButtonElement>('#btn-open-slicer')
const btnProjectSave = $<HTMLButtonElement>('#btn-project-save')
const btnProjectOpen = $<HTMLButtonElement>('#btn-project-open')
const projectInput = $<HTMLInputElement>('#project-input')
const canvasSource = $<HTMLCanvasElement>('#canvas-source')
const canvasQuantized = $<HTMLCanvasElement>('#canvas-quantized')
const deltaeStats = $<HTMLParagraphElement>('#deltae-stats')
const lightFrontBtn = $<HTMLButtonElement>('#light-front')
const lightBackBtn = $<HTMLButtonElement>('#light-back')
const lightNote = $<HTMLParagraphElement>('#light-note')
const quantizedCard = $<HTMLDivElement>('#viewer-quantized')
const layerSlider = $<HTMLInputElement>('#layer-slider')
const layerTicks = $<HTMLDivElement>('#layer-ticks')
const layerReadout = $<HTMLSpanElement>('#layer-readout')
const layerSwatch = $<HTMLSpanElement>('#layer-swatch')
const layerBand = $<HTMLSpanElement>('#layer-band')
const colorsSlider = $<HTMLInputElement>('#colors-slider')
const colorsValue = $<HTMLInputElement>('#colors-value')
const sliderTicks = $<HTMLDivElement>('#slider-ticks')
const ditherSlider = $<HTMLInputElement>('#dither-slider')
const ditherValue = $<HTMLSpanElement>('#dither-value')
const mergeCheck = $<HTMLInputElement>('#merge-deltae-check')
const mergeInput = $<HTMLInputElement>('#merge-deltae')
const mergeThreshWrap = $<HTMLElement>('#merge-thresh-wrap')

const SLIDER_MIN = 2
const SLIDER_MAX = 8
const PRESET_TICKS = [2, 4, 6, 8]
const widthInput = $<HTMLInputElement>('#width-mm')
const heightInput = $<HTMLInputElement>('#height-mm')
const baseInput = $<HTMLInputElement>('#base-mm')
const maxInput = $<HTMLInputElement>('#max-mm')
const layerInput = $<HTMLInputElement>('#layer-mm')
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
const welcomePanel = $<HTMLDivElement>('#welcome-panel')
const btnWelcomeTour = $<HTMLButtonElement>('#btn-welcome-tour')
const btnWelcomeHide = $<HTMLButtonElement>('#btn-welcome-hide')
const btnTour = $<HTMLButtonElement>('#btn-tour')

// Reference 3MF panel elements
const refDrop = $<HTMLDivElement>('#ref-drop')
const refInput = $<HTMLInputElement>('#ref-input')
const refReport = $<HTMLDivElement>('#ref-report')
const refStatus = $<HTMLParagraphElement>('#ref-status')
const refModelLine = $<HTMLParagraphElement>('#ref-model-line')
const refPaletteEl = $<HTMLDivElement>('#ref-palette')
const refSwaps = $<HTMLParagraphElement>('#ref-swaps')
const refMissingSection = $<HTMLDivElement>('#ref-missing-section')
const refMissing = $<HTMLParagraphElement>('#ref-missing')
const refWarningsSection = $<HTMLDivElement>('#ref-warnings-section')
const refWarningsEl = $<HTMLDivElement>('#ref-warnings')
const refApplyBtn = $<HTMLButtonElement>('#ref-apply')
const refApplyNote = $<HTMLParagraphElement>('#ref-apply-note')
const refEmpty = $<HTMLParagraphElement>('#ref-empty')
const refError = $<HTMLParagraphElement>('#ref-error')
const refBadge = $<HTMLSpanElement>('#ref-badge')

function setProcessing(on: boolean) {
  processingOverlay.hidden = !on
  btnStl.disabled = on
  btn3mf.disabled = on
  btnDescribe.disabled = on
  btnSlicer.disabled = on
  btnOpenSlicer.disabled = on
  btnProjectSave.disabled = on
}

/** Set the color count, refresh the UI, and reprocess if an image is loaded. */
function applyCount(v: number) {
  const clamped = Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, Math.round(v) || SLIDER_MIN))
  colorsSlider.value = String(clamped)
  colorsValue.value = String(clamped)
  renderTicks()
  saveSettings()
  if (currentFile) void readFile(currentFile)
}

// ---- persisted print settings (color count + size), like language/theme ----
const SETTINGS_KEY = 'hf-settings'

type Settings = {
  colors: number
  widthMm: number
  heightMm: number
  baseMm: number
  maxMm: number
  layerMm: number
  dither: number
  backlight: boolean
  mergeDeltaE: number
  dropThreshold: number
}
/** Clamp to [lo, hi]; non-finite or missing input falls back to `fb`. */
function clampNum(v: number, lo: number, hi: number, fb: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb
}

/** Enable the ΔE-threshold input only while the merge checkbox is on. */
function syncMergeThreshold() {
  mergeThreshWrap.style.opacity = mergeCheck.checked ? '1' : '0.45'
  mergeInput.disabled = !mergeCheck.checked
}

/** Read the current UI values and persist them (mirrors readOptions' clamps). */
function saveSettings() {
  try {
    const baseMm = clampNum(Number(baseInput.value), 0, 5, 0.8)
    const settings: Settings = {
      colors: Math.round(clampNum(Number(colorsSlider.value), SLIDER_MIN, SLIDER_MAX, 4)),
      widthMm: clampNum(Number(widthInput.value), 20, 500, 150),
      heightMm: clampNum(Number(heightInput.value), 20, 500, 150),
      baseMm,
      maxMm: clampNum(Number(maxInput.value), baseMm + 2, 40, 8),
      layerMm: clampNum(Number(layerInput.value), 0.04, 0.6, 0.2),
      dither: clampNum(Number(ditherSlider.value), 0, 100, 0),
      backlight: lightBackBtn.classList.contains('is-active'),
      mergeDeltaE: mergeCheck.checked ? clampNum(Math.round(Number(mergeInput.value)), 1, 40, 10) : 0,
      dropThreshold: clampNum(Number(dropSparseThreshold.value), 0.1, 10, 1),
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* private mode */
  }
}

/** Apply stored settings to the controls; corrupt/missing data is ignored. */
function restoreSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return
    const s = JSON.parse(raw) as Partial<Settings>
    const colors = Math.round(clampNum(Number(s.colors), SLIDER_MIN, SLIDER_MAX, 4))
    const baseMm = clampNum(Number(s.baseMm), 0, 5, 0.8)
    colorsSlider.value = String(colors)
    colorsValue.value = String(colors)
    widthInput.value = String(clampNum(Number(s.widthMm), 20, 500, 150))
    heightInput.value = String(clampNum(Number(s.heightMm), 20, 500, 150))
    baseInput.value = String(baseMm)
    maxInput.value = String(clampNum(Number(s.maxMm), baseMm + 2, 40, 8))
    layerInput.value = String(clampNum(Number(s.layerMm), 0.04, 0.6, 0.2))
    ditherSlider.value = String(clampNum(Number(s.dither), 0, 100, 0))
    ditherValue.textContent = `${ditherSlider.value}%`
    if (s.mergeDeltaE !== undefined) {
      const on = s.mergeDeltaE > 0
      mergeCheck.checked = on
      if (on) mergeInput.value = String(clampNum(Math.round(Number(s.mergeDeltaE)), 1, 40, 10))
      syncMergeThreshold()
    }
    if (s.backlight === true) setLightMode('back')
    if (s.dropThreshold !== undefined) {
      dropSparseThreshold.value = String(clampNum(Number(s.dropThreshold), 0.1, 10, 1))
    }
  } catch {
    /* ignore corrupt settings */
  }
}

/** Current preview lighting: 'front' (default) or 'back' (transmission-only). */
let lightMode: 'front' | 'back' = 'front'

/**
 * Switch the print preview between front-lit (stack over opaque base) and
 * backlit (transmission-only fold from white, no base reflection). Also
 * flips the canvas backdrop so the dark-background backlit look reads.
 */
function setLightMode(mode: 'front' | 'back') {
  lightMode = mode
  const back = mode === 'back'
  lightFrontBtn.classList.toggle('is-active', !back)
  lightBackBtn.classList.toggle('is-active', back)
  quantizedCard.classList.toggle('is-backlit', back)
  lightNote.dataset.i18n = back ? 'lightNoteBack' : 'lightNoteFront'
  lightNote.textContent = tr(back ? 'lightNoteBack' : 'lightNoteFront')
  lightNote.hidden = !current
  saveSettings()
  if (current) drawQuantized()
}

lightFrontBtn.addEventListener('click', () => setLightMode('front'))
lightBackBtn.addEventListener('click', () => setLightMode('back'))

function readOptions() {
  // Clamp every numeric input to sane bounds: Number() can yield NaN/±Infinity
  // (e.g. "1e999", "abc"), which must never reach the geometry or exports.
  const clampNum = (v: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
  const numColors = clampNum(Math.round(Number(colorsSlider.value)), SLIDER_MIN, SLIDER_MAX, 4)
  const darkIsTall = document.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value !== 'light'
  const dither = clampNum(Number(ditherSlider.value), 0, 100, 0) / 100
  const mergeDeltaE = mergeCheck.checked ? clampNum(Math.round(Number(mergeInput.value)), 1, 40, 10) : 0
  const baseMm = clampNum(Number(baseInput.value), 0, 5, 0.8)
  const maxHeightMm = clampNum(Number(maxInput.value), baseMm + 2, 40, 8)
  return {
    numColors: numColors as ColorCount,
    darkIsTall,
    dither,
    bandHeightsMm: bandHeights ?? undefined,
    widthMm: clampNum(Number(widthInput.value), 20, 500, 150),
    heightMm: clampNum(Number(heightInput.value), 20, 500, 150),
    baseMm,
    maxHeightMm,
    layerMm: clampNum(Number(layerInput.value), 0.04, 0.6, 0.2),
    mergeDeltaE,
  }
}

function showStatus(msg: string, isError = false) {
  exportStatus.textContent = msg
  exportStatus.style.color = isError ? 'var(--danger)' : 'var(--muted)'
}

async function readFile(file: File, fresh = false): Promise<boolean> {
  currentFile = file
  const token = ++runToken
  showStatus(tr('processing'))
  setProcessing(true)
  try {
    const opts = readOptions()
    // Catalog palette mode survives reprocesses: re-quantize against the same
    // spool colors while every slot still carries a real filament; if any
    // slot lost its assignment (color-count change, manual color edit) fall
    // back to the plain luminance-brightness palette.
    let overrides: { palette?: RGB[]; nearest?: boolean } | undefined
    if (catalogActive) {
      const spools = catalogSpools()
      if (spools) {
        overrides = { palette: spools.colors, nearest: true }
        filamentAssignments = spools.ids
      } else {
        catalogActive = false
        updateCatalogBtn()
      }
    }
    const { image, sourceWidth, sourceHeight } = await loadImageForPrint(file, opts.widthMm, opts.heightMm, lang)
    // Only a freshly loaded image sets the print size to its aspect ratio
    // (the larger print side is kept). Rebinds pass fresh=false so settings
    // edits, palette work, and project loads keep the explicit size.
    if (fresh) {
      const fitted = fitPrintSizeToAspect(sourceWidth, sourceHeight, opts.widthMm, opts.heightMm)
      if (fitted.widthMm !== opts.widthMm || fitted.heightMm !== opts.heightMm) {
        opts.widthMm = fitted.widthMm
        opts.heightMm = fitted.heightMm
        widthInput.value = String(fitted.widthMm)
        heightInput.value = String(fitted.heightMm)
        saveSettings()
      }
    }
    const t0 = performance.now()
    const result = await quantizeInWorker(image.rgba.slice(), image.width, image.height, opts, overrides)
    perf.recordQuantize(performance.now() - t0)
    perf.recordBuffers({
      rgbaBytes: image.rgba.length,
      indexBytes: result.quantized.indexMap.length,
      fieldBytes: result.field.values.length * 4,
      width: image.width,
      height: image.height,
    })
    perf.recordMesh(result.mesh.triangleCount)
    renderPerf()
    if (token !== runToken) {
      // A newer run superseded this one; the delivered result was discarded.
      perf.recordDiscarded('quantize')
      renderPerf()
      return false
    }
    current = { ...result, image }
    // The ΔE merge can shrink the palette: remap per-slot filament
    // assignments through the kept-slot report so ★-stars follow colors.
    let mergedMsg = false
    if (result.mergeKept) {
      const kept = result.mergeKept
      const before = filamentAssignments
      filamentAssignments = kept.map((i) => before[i] ?? null)
      const dropped = before.length - kept.length
      if (dropped > 0) {
        showStatus(
          tr('mergeApplied', {
            n: String(dropped),
            a: String(before.length),
            b: String(kept.length),
          }),
        )
        mergedMsg = true
      }
    }
    // Custom band heights are indexed by palette slot: a color-count change
    // invalidates them, and a fresh run re-stamps the effective heights.
    if (bandHeights && bandHeights.length !== result.quantized.palette.length) bandHeights = null
    bandHeights = result.quantized.bandHeightsMm?.slice() ?? null
    initTau(current.quantized)
    autoPalette = result.quantized.palette.map((c) => ({ ...c }))
    updateUI()
    if (referencePlan) updateApplyButton() // image availability changes Apply
    setProcessing(false)
    if (!mergedMsg) {
      showStatus(tr('ready', { colors: word(lang, current.quantized.palette.length, 'colors') }))
    }
    noteSettled()
    return true
  } catch (err) {
    if (token !== runToken) return false
    setProcessing(false)
    current = null
    btnStl.disabled = true
    btn3mf.disabled = true
    btnDescribe.disabled = true
    btnSlicer.disabled = true
    btnOpenSlicer.disabled = true
    btnProjectSave.disabled = true
    calibBlock.hidden = true
    printabilityList.innerHTML = ''
    printabilitySummary.textContent = tr('pbDefault')
    pbBadge.hidden = true
    showStatus(err instanceof Error ? err.message : String(err), true)
    return false
  }
}

/** Write every [data-i18n] element (and aria-labels) in the current language. */
function applyStaticText() {
  document.documentElement.lang = lang
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n
    if (key) el.textContent = tr(key)
  }
  // Help: every [data-help] element gets a localized tooltip; sections also
  // title themselves so hovering anywhere on the intro paragraph explains it.
  for (const el of document.querySelectorAll<HTMLElement>('[data-help]')) {
    const key = el.dataset.help
    if (!key) continue
    el.title = tr(key)
    el.ariaLabel = tr(key)
  }
  colorsSlider.ariaLabel = tr('sliderAria')
  colorsValue.ariaLabel = tr('sliderValueAria')
  const cubeOverlay = document.getElementById('cube-overlay')
  if (cubeOverlay) {
    cubeOverlay.title = tr('cubeHint')
    cubeOverlay.ariaLabel = tr('cubeTitle')
  }
  const homeBtn = document.getElementById('viewer-home')
  if (homeBtn) {
    homeBtn.title = tr('viewerHome')
    homeBtn.ariaLabel = tr('viewerHome')
  }
  const topBtn = document.getElementById('viewer-top')
  if (topBtn) {
    topBtn.title = tr('viewerTop')
    topBtn.ariaLabel = tr('viewerTop')
  }
  syncPaletteCollapsedNote()
  autoPickBtn.title = tr('autoPickHelp')
  autoPickBtn.ariaLabel = tr('autoPickHelp')
  viewer3d?.setFaceLabels(cubeFaceLabels())
  updateCatalogBtn() // the catalog toggle label depends on its active state
  renderTicks() // rebuild tick tooltips/labels in the current language
  fillPrinterSelect() // option labels and tooltip follow the language
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
  // the banner always shows the committed theme again. A tooltip above the
  // swatch names the theme and shows a mini palette of its colors.
  const peekTheme = (theme: string) => applyTheme(theme, false)
  const peeked: HTMLButtonElement[] = []

  // CSS variables sampled for the mini palette. They are read from the live
  // document, which the peek already recolored to the hovered theme, so the
  // dots always match the theme being previewed.
  const THEME_TIP_VARS = ['--accent', '--accent-2', '--bg', '--panel-2', '--text']
  const tipDot = (v: string) => {
    const dot = document.createElement('span')
    dot.className = 'theme-tip-dot'
    dot.style.background = getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888'
    return dot
  }
  const showTip = (b: HTMLButtonElement) => {
    const tip = b.querySelector<HTMLElement>('.theme-tip')
    const palette = tip?.querySelector('.theme-tip-palette')
    if (!tip || !palette) return
    palette.replaceChildren(...THEME_TIP_VARS.map(tipDot))
    tip.hidden = false
  }
  const hideTip = (b: HTMLButtonElement) => {
    const tip = b.querySelector<HTMLElement>('.theme-tip')
    if (tip) tip.hidden = true
  }

  bannerThemeBtns.forEach((b) => {
    b.addEventListener('mouseenter', () => {
      peekTheme(b.dataset.theme ?? '')
      showTip(b)
    })
    b.addEventListener('mouseleave', () => {
      hideTip(b)
      peekTheme(chosenTheme)
    })
    b.addEventListener('focus', () => {
      peeked.push(b)
      peekTheme(b.dataset.theme ?? '')
      showTip(b)
    })
    b.addEventListener('blur', () => {
      const i = peeked.indexOf(b)
      if (i >= 0) peeked.splice(i, 1)
      hideTip(b)
      if (peeked.length === 0) peekTheme(chosenTheme)
    })
    b.addEventListener('click', () => {
      const v = b.dataset.theme
      if (v) {
        chosenTheme = v
        peeked.length = 0
        hideTip(b)
        setPressed(bannerThemeBtns, v)
        applyTheme(v) // persist
      }
    })
  })

  // Start persists the chosen language (even when it equals the detected one)
  // and the theme the user is currently looking at, then dismisses the banner.
  // Persisting the live theme (not the stale `chosenTheme`) matters because a
  // hover/focus peek previews without committing — someone who hovers Solar
  // and hits Start expects Solar, not the default they started from.
  bannerStart.addEventListener('click', () => {
    saveLang(chosenLang)
    if (chosenLang !== lang) setLang(chosenLang)
    chosenTheme = document.documentElement.dataset.theme ?? 'dark'
    applyTheme(chosenTheme)
    langBanner.hidden = true
    // First-run: once the banner is confirmed, walk the new user through the
    // sections. Returning users can restart the tour from the top bar.
    try {
      if (!localStorage.getItem(TOUR_SEEN_KEY)) startAppTour()
    } catch {
      /* private mode */
    }
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

// ---- welcome panel + guided tour -----------------------------------------

const WELCOME_DISMISS_KEY = 'hf-welcome-dismissed'
const TOUR_SEEN_KEY = 'hf-tour-seen'
let tourStop: (() => void) | null = null

/**
 * Onboarding resolved: hide the welcome for good and remember the tour was
 * seen (finish, skip or explicit «Hide») so neither the panel nor the tour
 * auto-start ever come back on later visits.
 */
function markOnboardingDone() {
  welcomePanel.hidden = true
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1')
    localStorage.setItem(WELCOME_DISMISS_KEY, '1')
  } catch {
    /* private mode */
  }
}

/** Starts the spotlight tour; a no-op while it is already running. */
function startAppTour() {
  if (tourStop) return
  tourStop = startTour(TOUR_STEPS, {
    tr,
    plural: (n, wordKey) => word(lang, n, wordKey),
    onFinish: () => {
      tourStop = null
      markOnboardingDone()
    },
    onSkip: () => {
      tourStop = null
      markOnboardingDone()
    },
  })
}

function setupWelcome() {
  // First visit only: the welcome stays visible until onboarding is resolved
  // (tour seen or «Hide» clicked) — after that it never returns.
  try {
    if (localStorage.getItem(TOUR_SEEN_KEY) !== null || localStorage.getItem(WELCOME_DISMISS_KEY)) welcomePanel.hidden = true
  } catch {
    /* private mode — keep the panel visible */
  }
  btnWelcomeTour.addEventListener('click', startAppTour)
  btnTour.addEventListener('click', startAppTour)
  btnWelcomeHide.addEventListener('click', () => {
    // Hiding the welcome also declines the tour auto-start.
    markOnboardingDone()
  })
}

function updateUI() {
  if (!current) return
  syncMaxInput()
  drawSource()
  drawQuantized()
  renderPalette()
  renderPrintability()
  update3d()
  calibBlock.hidden = false
  drawLayerView()
  btnStl.disabled = false
  btn3mf.disabled = false
  btnDescribe.disabled = false
  btnSlicer.disabled = false
  btnOpenSlicer.disabled = false
  btnProjectSave.disabled = false
  autoPickBtn.disabled = false
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
    const fix = fixFor(check.id, current!)
    if (fix) {
      const btn = document.createElement('button')
      btn.className = 'fix-btn'
      btn.title = tr('pbFixTitle')
      btn.innerHTML =
        `<svg class="btn-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        `<path d="m4.2 12.8 8.2-8.2 1.6 1.6-8.2 8.2Z"/><path d="m12.6 2.2.4 1.6 1.6.4-1.6.4-.4 1.6-.4-1.6-1.6-.4 1.6-.4Z"/></svg>` +
        `<span>${tr('pbFix')}</span>`
      btn.addEventListener('click', () => applyFix(fix))
      body.append(btn)
    }
    row.append(icon, body)
    printabilityList.appendChild(row)
  }
  printabilitySummary.textContent =
    report.errors === 0 && report.warnings === 0
      ? tr('allPassed')
      : `${word(lang, report.errors, 'errors')} · ${word(lang, report.warnings, 'warnings')}`
  setPbBadge(report)
}

function fixLabel(fix: PrintabilityFix): string {
  switch (fix.kind) {
    case 'maxHeight':
      return tr('pbFixWhatMax', { v: mmOf(lang, fix.to) })
    case 'colors':
      return tr('pbFixWhatColors', { n: fix.to })
    case 'bandHeights':
      return tr('pbFixWhatHeights')
    case 'size':
      return tr('pbFixWhatSize', { w: mmOf(lang, fix.width), h: mmOf(lang, fix.height) })
  }
}

/** Apply an auto-fix: set the recommended inputs and reprocess in one step. */
async function applyFix(fix: PrintabilityFix) {
  switch (fix.kind) {
    case 'maxHeight':
      maxInput.value = String(fix.to)
      break
    case 'colors':
      colorsSlider.value = String(fix.to)
      colorsValue.value = String(fix.to)
      renderTicks()
      break
    case 'bandHeights':
      bandHeights = fix.heights
      syncMaxInput()
      break
    case 'size':
      widthInput.value = String(fix.width)
      heightInput.value = String(fix.height)
      break
  }
  saveSettings()
  // The reprocess overwrites the status with its own «Ready» message, so the
  // fix feedback is shown again once it has completed (and only on success).
  if (currentFile) {
    if (await readFile(currentFile)) showStatus(tr('pbFixApplied', { what: fixLabel(fix) }))
  } else {
    showStatus(tr('pbFixApplied', { what: fixLabel(fix) }))
  }
}

/** Collapsed-summary badge: worst finding at a glance without expanding. */
function setPbBadge(report: ReturnType<typeof analyzePrintability>) {
  if (report.errors > 0) {
    pbBadge.className = 'ref-badge error'
    pbBadge.textContent = `✕ ${word(lang, report.errors, 'errors')}`
  } else if (report.warnings > 0) {
    pbBadge.className = 'ref-badge partial'
    pbBadge.textContent = `⚠ ${word(lang, report.warnings, 'warnings')}`
  } else {
    pbBadge.className = 'ref-badge complete'
    pbBadge.textContent = `✓ ${tr('allPassed')}`
  }
  pbBadge.hidden = false
}

function drawSource() {
  const { width, height, rgba } = current!.image
  canvasSource.width = width
  canvasSource.height = height
  canvasSource.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
}

/** Ensure the quantized image carries a per-slot τ array (default everywhere). */
function initTau(q: QuantizedImage) {
  if (!q.tauMm || q.tauMm.length !== q.palette.length) {
    q.tauMm = q.palette.map(() => DEFAULT_TAU_MM)
  }
}

/** τ of palette slot i, clamped — the input's live value may be mid-edit. */
function tauOfSlot(i: number): number {
  const tau = current?.quantized.tauMm?.[i]
  return typeof tau === 'number' && Number.isFinite(tau) && tau > 0
    ? Math.min(6, Math.max(0.2, tau))
    : DEFAULT_TAU_MM
}

function drawQuantized() {
  const { width, height, indexMap, palette } = current!.quantized
  const n = palette.length
  // The finished print shows translucent blends, not opaque band colors:
  // per band, look up the transmitted column color (per-filament τ-aware).
  // Backlight mode swaps the lookup: pure transmission fold from white.
  const blends = lightMode === 'back' ? backlitBandColors(current!) : transmittedBandColors(current!)
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const slice = current!.settings.darkIsTall ? n - 1 - indexMap[i] : indexMap[i]
    const c = blends[slice] ?? palette[indexMap[i]]
    rgba[i * 4] = Math.round(c.r)
    rgba[i * 4 + 1] = Math.round(c.g)
    rgba[i * 4 + 2] = Math.round(c.b)
    rgba[i * 4 + 3] = 255
  }
  canvasQuantized.width = width
  canvasQuantized.height = height
  canvasQuantized.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0)
  drawDeltaE()
}

// ---- ΔE error map: target image vs predicted print appearance -------------

/**
 * Per-pixel ΔE2000 between the target image and the predicted front-lit
 * print (the same transmitted blends the quantized preview shows). Pixels
 * are sampled at half resolution for speed and upscaled smoothly; the
 * heatmap overlays a dimmed source so mismatches are visible in context.
 * The prediction is front-lit by design — the map is the same in both light
 * modes.
 */
/**
 * Per-pixel ΔE between the source image and the predicted print
 * appearance — the shared data for the 3D ΔE overlay and its stats
 * readout. Computed once per reprocess, cached until the inputs change.
 */
let deltaECache: { version: number; de: Float32Array } | null = null

function computeDeltaE(): Float32Array {
  const { width, height, indexMap, palette } = current!.quantized
  const n = palette.length
  const blends = transmittedBandColors(current!)
  const src = current!.image.rgba
  const darkIsTall = current!.settings.darkIsTall
  const de = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const si = i * 4
    const slice = darkIsTall ? n - 1 - indexMap[i] : indexMap[i]
    const c = blends[slice] ?? palette[indexMap[i]]
    de[i] = deltaE2000Rgb(src[si], src[si + 1], src[si + 2], c.r, c.g, c.b)
  }
  return de
}

/** Cached ΔE array, recomputed only when the reprocess version changes. */
function deltaEField(): Float32Array {
  const version = stateVersion
  if (!deltaECache || deltaECache.version !== version) {
    deltaECache = { version, de: computeDeltaE() }
  }
  return deltaECache.de
}

/** Update the mean/max ΔE readout under the 3D view (cheap, from cache). */
function drawDeltaE() {
  const de = deltaEField()
  let sum = 0
  let max = 0
  for (let i = 0; i < de.length; i++) {
    sum += de[i]
    if (de[i] > max) max = de[i]
  }
  deltaeStats.textContent = tr('deltaEStats', {
    mean: (sum / de.length).toFixed(1),
    max: max.toFixed(1),
  })
  deltaeStats.hidden = false
}

// ---- Layer-by-layer view -------------------------------------------------

/** Current position of the layer-view slider, as a fraction of total layers. */
let layerPos = 1 // 1 = top (final picture) on first load

/** Swap layers (1-indexed) — the layers where a new filament starts. */
function swapLayers(result: PipelineResult): number[] {
  const layerMm = result.settings.layerMm
  const total = Math.max(1, Math.round(result.settings.maxHeightMm / layerMm))
  const tops = [...result.palette].sort((a, b) => a.topZMm - b.topZMm).map((p) => p.topZMm)
  const layers: number[] = [1]
  for (const z of tops) {
    const l = Math.round(z / layerMm)
    if (l > 1 && l <= total && layers[layers.length - 1] !== l) layers.push(l)
  }
  return layers
}

/** Rebuild the swap ticks under the layer slider, highlighting the active one. */
function renderLayerTicks(result: PipelineResult, currentLayer: number) {
  const total = Math.max(1, Math.round(result.settings.maxHeightMm / result.settings.layerMm))
  const swaps = swapLayers(result)
  layerTicks.replaceChildren()
  for (const l of swaps) {
    const tick = document.createElement('span')
    tick.className = 'slider-tick layer-tick'
    // Same thumb-travel math as renderTicks: thumb center sits at 8px +
    // fraction × (100% − 16px) so ticks align with real slider positions.
    const frac = total > 1 ? (l - 1) / (total - 1) : 0
    tick.style.left = `calc(8px + ${frac} * (100% - 16px))`
    tick.title = tr('layerOfTotal', { n: l, total, z: (l * result.settings.layerMm).toFixed(2) })
    if (l === currentLayer) tick.classList.add('active')
    const line = document.createElement('span')
    line.className = 'tick-line'
    tick.appendChild(line)
    tick.addEventListener('click', () => {
      layerPos = (l - 1) / Math.max(1, total - 1)
      layerSlider.value = String(l)
      drawLayerView()
    })
    layerTicks.appendChild(tick)
  }
}

/**
 * Update the layer slider readout and push the cut height into the 3D
 * viewer (the 2D layer canvas is gone — the 3D slice mode shows it).
 */
function drawLayerView() {
  if (!current) return
  const total = Math.max(1, Math.round(current.settings.maxHeightMm / current.settings.layerMm))
  const l = Math.round(layerPos * (total - 1)) + 1
  layerSlider.max = String(total)
  layerSlider.value = String(l)
  const z = l * current.settings.layerMm
  const view = layerView(current, z)

  // Readout: layer position + the filament being printed at this height.
  layerReadout.textContent = tr('layerOfTotal', { n: view.layer, total: view.totalLayers, z: z.toFixed(2) })
  const activeSlice = view.activeBand
  const n = current.quantized.palette.length
  const entry = current.palette.find((p) => (current!.settings.darkIsTall ? n - p.printOrder : p.printOrder - 1) === activeSlice)
  if (entry) {
    const hex = rgbToHex(entry.color)
    layerSwatch.hidden = false
    layerSwatch.style.background = hex
    layerBand.textContent =
      view.layer >= view.totalLayers
        ? tr('layerTopDone')
        : tr('layerSwappingTo', { n: entry.printOrder, name: nearestFilament(entry.color, lang) })
  } else {
    layerSwatch.hidden = true
    layerBand.textContent = tr('layerBase')
  }
  renderLayerTicks(current, view.layer)
}

layerSlider.addEventListener('input', () => {
  const total = Math.max(1, Math.round((current?.settings.maxHeightMm ?? 8) / (current?.settings.layerMm ?? 0.2)))
  const l = Number(layerSlider.value)
  layerPos = total > 1 ? (l - 1) / (total - 1) : 1
  drawLayerView()
  // Slice mode follows the layer slider live.
  if (viewer3dMode === 'slice') applySliceTo3d()
})

/** Snapshot of the auto-quantized palette, so any color can be reset. */
let autoPalette: RGB[] = []

/**
 * Per-band sheet thickness in mm (palette order, dark → light). Null = equal
 * bands spanning base..max (the default). While set, the sum of the heights
 * is authoritative and the max-height field becomes a derived read-only
 * value; the «Equal heights» button clears this back to equal bands.
 */
let bandHeights: number[] | null = null

/**
 * Catalog palette mode: quantization assigns every pixel the nearest chosen
 * filament color (HueForge-style) instead of a luminance band. Stays active
 * across reprocesses while every slot still carries a real filament.
 */
let catalogActive = false

/**
 * Library filament assigned to each palette slot (by palette index). Keyed
 * by slot, not color, so it survives color tweaks and follows the band.
 * A null slot falls back to the nearest library suggestion.
 */
let filamentAssignments: (string | null)[] = []

/** Library filament for a slot: the assignment, else the nearest suggestion. */
function filamentForSlot(idx: number): LibraryChoice {
  const assigned = filamentAssignments[idx] ? findFilament(filamentAssignments[idx]!) : undefined
  if (assigned) return assigned
  const used = filamentAssignments.filter((id): id is string => id !== null)
  return nearestLibraryFilament(current!.quantized.palette[idx], used)
}

/** Human label for a slot's filament: "Bestfilament · PLA · Белый". */
function filamentLabel(choice: LibraryChoice): string {
  const colorName = lang === 'ru' ? choice.color.nameRu : choice.color.nameEn
  const brand = choice.brandId === CUSTOM_BRAND_ID ? tr('filamMyBrand') : choice.brandName
  return `${brand} · ${materialName(choice.materialId)} · ${colorName}`
}

/**
 * Replace one palette color and rebuild everything that depends on it.
 * Heights never change (they come from the index map), so only the mesh
 * colors, previews, 3D view, and exports are affected.
 */
function setPaletteColor(idx: number, rgb: RGB, fullUpdate = true) {
  if (!current) return
  // Optimistic mirror + preview; the worker rebuild lands moments later and
  // updates the mesh/previews via the result listener.
  current.quantized.palette[idx] = rgb
  drawQuantized()
  rebuildNow(fullUpdate)
}

/**
 * Effective sheet thickness (mm) for palette slot i — the custom height when
 * set, else the equal share of the usable height. Reads the geometry's own
 * values (quantized), so labels always match what will actually be printed.
 */
function bandThicknessForSlot(i: number): number {
  const q = current!.quantized
  if (q.bandHeightsMm && q.bandHeightsMm.length === q.palette.length) return q.bandHeightsMm[i]
  const usable = current!.settings.maxHeightMm - current!.settings.baseMm
  return Number((usable / q.palette.length).toFixed(2))
}

/**
 * Rebuild everything that depends on band heights (geometry, layers, 3D,
 * printability) without re-rendering the palette — the slider being dragged
 * must stay alive. Palette labels refresh on 'change' via updateUI().
 */
function applyBandHeights() {
  if (!current) return
  drawQuantized()
  drawLayerView()
  rebuildNow(false)
}

/**
 * Max-height input is a derived, read-only value while custom band heights
 * are active (total = base + Σh); the «Equal heights» button returns to
 * equal bands and re-enables it. Also shows/hides the reset button.
 */
function syncMaxInput() {
  const custom = !!bandHeights && bandHeights.length > 0
  maxInput.disabled = custom
  maxInput.title = custom ? tr('maxDerived') : ''
  if (custom) {
    const base = Number(baseInput.value) || 0.8
    maxInput.value = String(Number((base + bandHeights!.reduce((a, c) => a + c, 0)).toFixed(2)))
  }
  paletteHeightsReset.hidden = !custom
}

paletteHeightsReset.addEventListener('click', () => {
  bandHeights = null
  syncMaxInput()
  rebuildNow(true)
  saveSettings()
})

/**
 * The currently assigned catalog filaments as a dark → light palette.
 * Every slot must carry a real filament (library or custom) — returns null
 * otherwise. The ids are re-keyed to the sorted order so the ★ assignments
 * follow the colors they belong to across the slot reordering.
 */
function catalogSpools(): { colors: RGB[]; ids: (string | null)[] } | null {
  if (!current) return null
  const n = current.quantized.palette.length
  const entries: { rgb: RGB; id: string | null }[] = []
  for (let i = 0; i < n; i++) {
    const id = filamentAssignments[i]
    const f = id ? findFilament(id) : undefined
    if (!f) return null
    entries.push({ rgb: { ...f.color.rgb }, id })
  }
  entries.sort((a, b) => luminance(a.rgb) - luminance(b.rgb))
  return { colors: entries.map((e) => e.rgb), ids: entries.map((e) => e.id) }
}

function updateCatalogBtn() {
  const label = catalogBtn.querySelector<HTMLElement>('[data-i18n]')
  if (label) {
    label.dataset.i18n = catalogActive ? 'catalogReset' : 'catalogPick'
    label.textContent = tr(label.dataset.i18n)
  }
  catalogBtn.title = tr(catalogActive ? 'catalogResetHelp' : 'catalogPickHelp')
}

// ---- Undo/redo history (Ctrl+Z / Ctrl+Y) --------------------------------
//
// A snapshot captures the editor state that settles after each coherent
// change: settings (color count, dither, sizes, depth mode, backlight, band
// heights), palette slot colors, per-slot τ, filament assignments and the
// catalog mode. The snapshot of the CURRENT settled state is `baseline`;
// `undoStack` holds earlier baselines, `redoStack` redo targets. Undo/redo
// restore an earlier baseline by re-running the pipeline for the same image
// (honoring the saved settings and catalog assignments), then overlaying the
// saved palette — the same path project loads use.

const HISTORY_LIMIT = 50
/** Every palette-affecting value of the editor at one point in time. */
interface EditorSnapshot {
  settings: ProjectSettings
  catalogActive: boolean
  palette: ProjectPaletteSlot[]
}
let undoStack: EditorSnapshot[] = []
let redoStack: EditorSnapshot[] = []
let historyBaseline: EditorSnapshot | null = null
let historyBaselineFile: File | null = null
/** True while an undo/redo restore runs — its intermediate states are not
 *  recorded, and its own readFile must not reset the baseline. */
let restoringHistory = false
let settleTimer: number | undefined

const undoBtn = $<HTMLButtonElement>('#btn-undo')
const redoBtn = $<HTMLButtonElement>('#btn-redo')

/**
 * One palette slot exactly as projects serialize it (library filament id,
 * or the full embedded record for user-added ones), so history snapshots and
 * .hueforge.json files stay interchangeable.
 */
function captureSlotEntry(i: number): ProjectPaletteSlot {
  const color = current!.quantized.palette[i]
  const hex = rgbToHex(color)
  const tauMm = tauOfSlot(i)
  const assignedId = filamentAssignments[i]
  if (assignedId && isCustomId(assignedId)) {
    const choice = findFilament(assignedId)
    if (choice) {
      return {
        hex,
        tauMm,
        filament: {
          id: choice.color.id,
          nameRu: choice.color.nameRu,
          nameEn: choice.color.nameEn,
          hex: choice.color.hex,
          materialId: choice.materialId,
        },
      }
    }
  }
  return assignedId ? { hex, tauMm, filamentId: assignedId } : { hex, tauMm }
}

/** Everything undo/redo needs to recreate the current editor state. */
function captureSnapshot(): EditorSnapshot | null {
  if (!current) return null
  const n = current.quantized.palette.length
  const opts = readOptions()
  const settings: ProjectSettings = {
    colors: n,
    widthMm: opts.widthMm,
    heightMm: opts.heightMm,
    baseMm: opts.baseMm,
    maxMm: opts.maxHeightMm,
    layerMm: opts.layerMm,
    dither: Math.round(opts.dither * 100),
    darkIsTall: opts.darkIsTall,
    backlight: lightBackBtn.classList.contains('is-active'),
    ...(opts.mergeDeltaE ? { mergeDeltaE: opts.mergeDeltaE } : {}),
    ...(bandHeights && bandHeights.length ? { bandHeightsMm: [...bandHeights] } : {}),
  }
  return {
    settings,
    catalogActive,
    palette: current.quantized.palette.map((_, i) => captureSlotEntry(i)),
  }
}

function snapshotsEqual(a: EditorSnapshot, b: EditorSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function refreshHistory() {
  const can = !!current && !!currentFile && !restoringHistory
  const u = can && undoStack.length > 0
  const r = can && redoStack.length > 0
  undoBtn.disabled = !u
  redoBtn.disabled = !r
  undoBtn.title = u ? tr('undoHint') : tr('undoEmpty')
  redoBtn.title = r ? tr('redoHint') : tr('redoEmpty')
  undoBtn.ariaLabel = tr('undo')
  redoBtn.ariaLabel = tr('redo')
}

/**
 * Called at every point a coherent state settles (image load, re-quantize,
 * rebuild, project load). A new image starts a fresh history; otherwise the
 * state is committed as the new baseline after a short settle delay, so a
 * drag or typing burst produces one undo step.
 */
function noteSettled() {
  if (restoringHistory || !current || !currentFile) return
  const snap = captureSnapshot()
  if (!snap) return
  if (historyBaselineFile !== currentFile) {
    historyBaselineFile = currentFile
    undoStack = []
    redoStack = []
    historyBaseline = snap
    refreshHistory()
    return
  }
  scheduleSettle()
}

function scheduleSettle() {
  if (restoringHistory) return
  if (settleTimer !== undefined) clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => {
    settleTimer = undefined
    commitSettled()
  }, 700)
}

/** Commit the current state as the latest baseline (pushes the old one). */
function commitSettled() {
  if (restoringHistory || !current) return
  const snap = captureSnapshot()
  if (!snap) return
  if (historyBaseline && snapshotsEqual(historyBaseline, snap)) return
  if (historyBaseline) {
    undoStack.push(historyBaseline)
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  }
  historyBaseline = snap
  redoStack = []
  refreshHistory()
}

/** Land any pending settle so undo/redo act on the real current state. */
function flushSettle() {
  if (settleTimer !== undefined) {
    clearTimeout(settleTimer)
    settleTimer = undefined
    commitSettled()
  }
}

/**
 * Overlay hex colors and τ values on the freshly re-quantized palette. The
 * mesh picks them up through the rebuild that follows (and its result
 * listener updates previews live).
 */
function overlaySlotPalette(slots: ProjectPaletteSlot[]) {
  if (!current) return
  const n = Math.min(slots.length, current.quantized.palette.length)
  for (let i = 0; i < n; i++) {
    current.quantized.palette[i] = hexToRgb(slots[i].hex)
    current.quantized.tauMm![i] = Math.min(6, Math.max(0.2, slots[i].tauMm))
  }
}

/**
 * Restore one snapshot: filament assignments first (so the catalog path can
 * re-derive spools), then settings → full reprocess of the same image →
 * palette overlay → one rebuild to color the mesh. Returns success.
 */
async function restoreHistoryState(target: EditorSnapshot): Promise<boolean> {
  if (!currentFile || restoringHistory) return false
  restoringHistory = true
  try {
    filamentAssignments = new Array(target.settings.colors).fill(null)
    for (let i = 0; i < target.palette.length; i++) {
      const slot = target.palette[i]
      if (slot.filament) {
        restoreCustomFilament({
          id: slot.filament.id,
          nameRu: slot.filament.nameRu,
          nameEn: slot.filament.nameEn,
          hex: slot.filament.hex,
          rgb: hexToRgb(slot.filament.hex),
          materialId: slot.filament.materialId as MaterialId,
        } satisfies CustomFilament)
        filamentAssignments[i] = slot.filament.id
      } else if (slot.filamentId && findFilament(slot.filamentId)) {
        filamentAssignments[i] = slot.filamentId
      }
    }
    catalogActive = target.catalogActive
    updateCatalogBtn()
    applyProjectSettings(target.settings)
    await readFile(currentFile)
    if (!current) return false
    overlaySlotPalette(target.palette)
    const token = runToken
    const version = ++stateVersion
    await rebuildInWorker({
      opts: readOptions(),
      palette: current.quantized.palette.map((c) => ({ ...c })),
      token,
      version,
    })
    if (token !== runToken) return false
    historyBaseline = target
    updateUI()
    showStatus(tr('ready', { colors: word(lang, current.quantized.palette.length, 'colors') }))
    return true
  } catch (err) {
    showStatus(err instanceof Error ? err.message : String(err), true)
    return false
  } finally {
    restoringHistory = false
    refreshHistory()
  }
}

async function doUndo() {
  if (restoringHistory || !current || !currentFile) return
  flushSettle() // a pending commit may just have created the entry
  if (undoStack.length === 0) return
  const target = undoStack[undoStack.length - 1]!
  const now = captureSnapshot()
  if (!(await restoreHistoryState(target))) return
  undoStack.pop()
  if (now) {
    redoStack.push(now)
    if (redoStack.length > HISTORY_LIMIT) redoStack.shift()
  }
  refreshHistory()
}

async function doRedo() {
  if (restoringHistory || !current || !currentFile) return
  flushSettle()
  if (redoStack.length === 0) return
  const target = redoStack[redoStack.length - 1]!
  const now = captureSnapshot()
  if (!(await restoreHistoryState(target))) return
  redoStack.pop()
  if (now) {
    undoStack.push(now)
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  }
  refreshHistory()
}

undoBtn.addEventListener('click', () => void doUndo())
redoBtn.addEventListener('click', () => void doRedo())

// Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y; native text undo is left alone inside
// editable fields (the app's own text inputs keep browser undo).
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return
  const el = e.target as HTMLElement | null
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    const type = (el as HTMLInputElement).type
    if (type === 'text' || type === 'number' || type === 'search' || type === 'email' || type === 'tel' || type === 'url') return
  }
  const key = e.key.toLowerCase()
  if (key === 'z') {
    e.preventDefault()
    if (e.shiftKey) void doRedo()
    else void doUndo()
  } else if (key === 'y') {
    e.preventDefault()
    void doRedo()
  }
})

refreshHistory()

// ---- Performance monitoring panel ----------------------------------------
// Tracks pipeline timings (quantize / mesh rebuild, including the worker
// round-trip), discarded stale worker responses, and buffer sizes. The
// collector is a pure module; this section only records and renders.

const perf = createPerfStats()
const perfQuantizeEl = $<HTMLSpanElement>('#perf-quantize')
const perfRebuildEl = $<HTMLSpanElement>('#perf-rebuild')
const perfDiscardedEl = $<HTMLSpanElement>('#perf-discarded')
const perfBuffersEl = $<HTMLSpanElement>('#perf-buffers')
const perfMeshEl = $<HTMLSpanElement>('#perf-mesh')
const perfResetBtn = $<HTMLButtonElement>('#perf-reset')

function fmtMs(ms: number): string {
  const unit = lang === 'ru' ? 'мс' : 'ms'
  return ms < 10 ? `${ms.toFixed(1)} ${unit}` : `${Math.round(ms)} ${unit}`
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) {
    const u = lang === 'ru' ? 'МБ' : 'MB'
    return `${(n / (1024 * 1024)).toFixed(1)} ${u}`
  }
  if (n >= 1024) {
    const u = lang === 'ru' ? 'КБ' : 'KB'
    return `${Math.round(n / 1024)} ${u}`
  }
  return `${n} ${lang === 'ru' ? 'Б' : 'B'}`
}

function renderPerf() {
  const s = perf.snapshot()
  const q = s.quantize
  const r = s.rebuild
  perfQuantizeEl.textContent =
    q.count === 0
      ? '—'
      : `${fmtMs(q.lastMs)} · ср. ${fmtMs(q.avgMs)} (${q.count})`
  perfRebuildEl.textContent =
    r.count === 0
      ? '—'
      : `${fmtMs(r.lastMs)} · ср. ${fmtMs(r.avgMs)} (${r.count})`
  perfDiscardedEl.textContent =
    s.discarded.total === 0
      ? '—'
      : lang === 'ru'
        ? `${s.discarded.total} (квант. ${s.discarded.quantize} · меш ${s.discarded.rebuild})`
        : `${s.discarded.total} (quant. ${s.discarded.quantize} · mesh ${s.discarded.rebuild})`
  const b = s.buffers
  perfBuffersEl.textContent =
    b.rgbaBytes === 0
      ? '—'
      : `${b.width}×${b.height} · ${fmtBytes(b.rgbaBytes)} · ${fmtBytes(b.indexBytes)} · ${fmtBytes(b.fieldBytes)}`
  perfMeshEl.textContent =
    b.triangles === 0 ? '—' : `${b.triangles.toLocaleString(lang)} тр. · ${fmtBytes(b.meshBytes)}`
}

perfResetBtn.title = tr('perfResetTitle')
perfResetBtn.ariaLabel = tr('perfResetTitle')
perfResetBtn.addEventListener('click', () => {
  perf.reset()
  renderPerf()
})

renderPerf()

/**
 * Horizontal stacked-bar coverage chart: one segment per palette color, its
 * width = its share of the printed area, so color balance reads at a glance
 * (a fat segment = a heavy color; a sliver = a barely-used spool).
 */
function renderCoverage(
  shares: ReturnType<typeof colorShares>,
  palette: { color: RGB }[],
) {
  paletteCoverage.replaceChildren()
  if (!palette.length) {
    paletteCoverage.hidden = true
    return
  }
  paletteCoverage.hidden = false
  for (let i = 0; i < palette.length; i++) {
    const seg = document.createElement('span')
    seg.className = 'coverage-seg'
    seg.style.background = rgbToHex(palette[i].color)
    // Flex-grow proportional to share (a percent floor keeps 0-share slots
    // visible as hairlines instead of vanishing).
    seg.style.flexGrow = String(Math.max(shares[i].percent, 0.5))
    seg.title = tr('coverageSegTitle', {
      order: String(i + 1),
      hex: rgbToHex(palette[i].color),
      pct: formatShare(shares[i].percent),
    })
    paletteCoverage.appendChild(seg)
  }
}

/** Re-quantize the image against the chosen spool colors (nearest-color). */
async function quantizeCatalog(spools: RGB[]) {
  if (!current || !currentFile) return
  const token = ++runToken
  showStatus(tr('processing'))
  setProcessing(true)
  try {
    const opts = readOptions()
    const { image } = await loadImageForPrint(currentFile, opts.widthMm, opts.heightMm, lang)
    const t0 = performance.now()
    const result = await quantizeInWorker(image.rgba.slice(), image.width, image.height, opts, {
      palette: spools,
      nearest: true,
    })
    perf.recordQuantize(performance.now() - t0)
    perf.recordBuffers({
      rgbaBytes: image.rgba.length,
      indexBytes: result.quantized.indexMap.length,
      fieldBytes: result.field.values.length * 4,
      width: image.width,
      height: image.height,
    })
    perf.recordMesh(result.mesh.triangleCount)
    renderPerf()
    if (token !== runToken) {
      perf.recordDiscarded('quantize')
      renderPerf()
      return
    }
    current = { ...result, image }
    // Custom band heights follow the color count; a fresh run re-stamps them.
    if (bandHeights && bandHeights.length !== result.quantized.palette.length) bandHeights = null
    bandHeights = result.quantized.bandHeightsMm?.slice() ?? null
    initTau(current.quantized)
    autoPalette = result.quantized.palette.map((c) => ({ ...c }))
    updateUI()
    setProcessing(false)
    showStatus(tr('catalogDone', { colors: word(lang, spools.length, 'colors') }))
    noteSettled()
  } catch (err) {
    if (token !== runToken) return false
    setProcessing(false)
    showStatus(err instanceof Error ? err.message : String(err), true)
  }
}

catalogBtn.addEventListener('click', () => {
  if (!current) return
  if (catalogActive) {
    catalogActive = false
    updateCatalogBtn()
    if (currentFile) void readFile(currentFile)
    return
  }
  // No per-slot assignments yet → open the one-step catalog dialog instead
  // of demanding N manual ★ picks.
  const assigned = filamentAssignments.filter((id) => id !== null).length
  if (assigned === 0) {
    openCatalogDialog()
    return
  }
  const spools = catalogSpools()
  if (!spools) {
    showStatus(tr('catalogNeedAll'), true)
    return
  }
  catalogActive = true
  filamentAssignments = spools.ids
  updateCatalogBtn()
  void quantizeCatalog(spools.colors)
})

/**
 * One-click cleanup: re-quantize against the spools that actually carry
 * area (≥1%), dropping the rest — each dropped spool saves a filament swap
 * on the printer. Only offered in catalog mode where spools define colors.
 */
dropSparseBtn.addEventListener('click', () => {
  if (!current || !catalogActive) return
  const spools = catalogSpools()
  if (!spools) return
  const result = dropSparseColors(current.quantized.indexMap, spools.colors, clampNum(Number(dropSparseThreshold.value), 0.1, 10, 1) / 100)
  if (!result) {
    showStatus(tr('dropSparseNone'), true)
    return
  }
  // Keep assignments of the surviving spools (dark → light order is
  // preserved by dropSparseColors, so ids follow their colors).
  const survivors = new Set(result.palette.map((c) => `${c.r},${c.g},${c.b}`))
  const keptIds: (string | null)[] = []
  const keptColors: RGB[] = []
  for (let i = 0; i < spools.colors.length; i++) {
    const c = spools.colors[i]
    if (survivors.has(`${c.r},${c.g},${c.b}`)) {
      keptColors.push(c)
      keptIds.push(spools.ids[i])
    }
  }
  filamentAssignments = keptIds
  void quantizeCatalog(keptColors)
  showStatus(tr('dropSparseDone', { n: String(result.dropped) }))
})

/**
 * Editing the drop threshold re-evaluates which spools count as "barely
 * used": the button label, tooltip and drop itself all follow the field.
 */
dropSparseThreshold.addEventListener('input', () => {
  const v = Number(dropSparseThreshold.value)
  if (Number.isFinite(v) && v >= 0.1 && v <= 10) {
    dropSparseThreshold.value = String(v)
    saveSettings()
    if (current) renderPalette()
  }
})

/**
 * Shopping list export: every distinct filament in the palette as a
 * downloadable TXT — brand, material, color, bands, area share.
 */
shoppingListBtn.addEventListener('click', () => {
  if (!current) return
  const items = shoppingList(filamentAssignments, current.quantized.indexMap, lang)
  const unassigned = unassignedCount(filamentAssignments)
  const base = exportFilename(current, 'txt').replace(/\.txt$/, '')
  const filename = `${base}-shopping-list.txt`
  const header = lang === 'ru'
    ? `HueForge Web — список покупок (${word(lang, items.length, 'spools')})`
    : `HueForge Web — shopping list (${word(lang, items.length, 'spools')})`
  const text = formatShoppingList(items, { unassigned, lang, header })
  triggerDownload(text, filename, 'text/plain;charset=utf-8')
  showStatus(tr('shoppingListDone', { filename }))
})

/**
 * Single dialog "Build from catalog": pick N spools across brands/materials
 * in one modal, confirm, and the palette + quantization are assembled in one
 * step — no per-slot ★ needed.
 */
function openCatalogDialog() {
  closeLibraryPopover()
  const back = document.createElement('div')
  back.className = 'catalog-dlg-back'
  back.id = 'catalog-dlg'

  const dlg = document.createElement('div')
  dlg.className = 'catalog-dlg'

  const title = document.createElement('div')
  title.className = 'filam-pop-title'
  title.textContent = tr('catdlgTitle')
  const hint = document.createElement('div')
  hint.className = 'filam-pop-hint'
  hint.textContent = tr('catdlgHint')

  // Brand / material selectors + a live counter, mirroring the ★ popover.
  let brandId = BRANDS[0].id
  let materialId: MaterialId = 'pla'
  let searchQuery = ''
  const selected = new Map<string, { hex: string; rgb: RGB; label: string }>()

  const controls = document.createElement('div')
  controls.className = 'catdlg-controls'
  const counter = document.createElement('span')
  counter.className = 'catdlg-counter'

  const updateCounter = () => {
    counter.textContent = tr('catdlgCount', { n: String(selected.size) })
    counter.classList.toggle('is-full', selected.size >= SLIDER_MAX)
    okBtn.disabled = selected.size < 2
  }

  // ---- Search: filters the grid by color/brand name across all brands ----
  const searchInput = document.createElement('input')
  searchInput.type = 'search'
  searchInput.className = 'catdlg-search'
  searchInput.placeholder = tr('catdlgSearchPlaceholder')
  searchInput.setAttribute('aria-label', tr('catdlgSearchPlaceholder'))
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase()
    renderGrid()
  })

  // ---- Recently used: one-click row of the user's usual spools ----
  const recentsRow = document.createElement('div')
  recentsRow.className = 'catdlg-recents'
  const recentIds = recentSpoolIds()
  if (recentIds.length > 0) {
    const label = document.createElement('span')
    label.className = 'catdlg-recents-label'
    label.textContent = tr('catdlgRecents')
    recentsRow.appendChild(label)
    for (const id of recentIds) {
      const f = findFilament(id)
      if (!f) continue
      const cell = document.createElement('button')
      cell.type = 'button'
      cell.className = 'catdlg-cell catdlg-recent'
      cell.title = `${f.brandName} · ${materialName(f.materialId)} · ${lang === 'ru' ? f.color.nameRu : f.color.nameEn}`
      const sw = document.createElement('span')
      sw.className = 'catdlg-swatch'
      sw.style.background = f.color.hex
      cell.append(sw)
      cell.addEventListener('click', () => toggleSpool(f, f.materialId))
      recentsRow.appendChild(cell)
    }
  }

  const brandSel = librarySelect(
    tr('filamBrandLabel'),
    BRANDS.map((b) => ({ value: b.id, label: b.name })),
    brandId,
    (v) => {
      brandId = v
      renderGrid()
    },
  )
  const materialSel = librarySelect(
    tr('filamMaterialLabel'),
    MATERIALS.map((m) => ({ value: m, label: materialName(m) })),
    materialId,
    (v) => {
      materialId = v as MaterialId
      renderGrid()
    },
  )
  controls.append(brandSel, materialSel, counter)

  const grid = document.createElement('div')
  grid.className = 'catdlg-grid'

  const okBtn = document.createElement('button')
  okBtn.type = 'button'
  okBtn.className = 'catdlg-ok'
  okBtn.textContent = tr('catdlgApply')
  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.className = 'catdlg-cancel'
  cancelBtn.textContent = tr('catdlgCancel')

  /** Shared grid/recents toggle: flip selection state for one filament. */
  const toggleSpool = (f: { color: { id: string; hex: string; rgb: RGB; nameRu: string; nameEn: string }, brandName: string }, material: MaterialId) => {
    if (selected.has(f.color.id)) {
      selected.delete(f.color.id)
    } else {
      if (selected.size >= SLIDER_MAX) return
      selected.set(f.color.id, {
        hex: f.color.hex,
        rgb: { ...f.color.rgb },
        label: `${f.brandName} · ${materialName(material)} · ${lang === 'ru' ? f.color.nameRu : f.color.nameEn}`,
      })
    }
    updateCounter()
    syncSelectedClasses()
  }

  /** Selection changed: rebuild the grid so cells re-mark and re-filter. */
  const syncSelectedClasses = () => renderGrid()

  const renderGrid = () => {
    grid.replaceChildren()
    const brandName = BRANDS.find((b) => b.id === brandId)?.name ?? brandId
    for (const c of LIBRARY[brandId][materialId].colors) {
      const name = lang === 'ru' ? c.nameRu : c.nameEn
      // Search matches color name, brand name, or material across all brands.
      if (searchQuery) {
        const hayRu = `${c.nameRu} ${brandName} ${materialName(materialId)}`.toLowerCase()
        const nameMatch = hayRu.includes(searchQuery) || `${c.nameEn} ${brandName} ${materialName(materialId)}`.toLowerCase().includes(searchQuery)
        if (!nameMatch) continue
      }
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'catdlg-cell'
      btn.title = name
      const sw = document.createElement('span')
      sw.className = 'catdlg-swatch'
      sw.style.background = c.hex
      btn.append(sw)
      if (selected.has(c.id)) btn.classList.add('is-selected')
      btn.addEventListener('click', () => {
        toggleSpool({ color: c, brandName }, materialId)
      })
      grid.appendChild(btn)
    }
  }
  renderGrid()
  updateCounter()

  cancelBtn.addEventListener('click', () => back.remove())
  back.addEventListener('click', (e) => {
    if (e.target === back) back.remove()
  })
  okBtn.addEventListener('click', () => {
    if (selected.size < 2) return
    const picks = [...selected.entries()].map(([id, v]) => ({ id, rgb: v.rgb }))
    recordRecentSpools(picks.map((p) => p.id))
    const ordered = orderSpools(picks)
    // ★ assignments follow their spools so the rows show the real plastic.
    filamentAssignments = [...ordered.ids]
    catalogActive = true
    updateCatalogBtn()
    back.remove()
    void quantizeCatalog(ordered.colors)
  })

  const footer = document.createElement('div')
  footer.className = 'catdlg-footer'
  footer.append(okBtn, cancelBtn)

  dlg.append(title, hint, searchInput, recentsRow, controls, grid, footer)
  back.appendChild(dlg)
  document.body.appendChild(back)
}

/**
 * Auto-pick: suggest the closest real filament for every palette color
 * (unique assignment, so N slots get N different spools), adopt each
 * suggestion's color into the palette and record it as the slot's filament.
 * The user can then fine-tune any slot through the ★ popover.
 */
autoPickBtn.addEventListener('click', () => {
  if (!current) return
  const palette = current.quantized.palette
  const result = autoPickFilaments(palette)
  if (!result.ids.some(Boolean)) {
    showStatus(tr('autoPickNone'), true)
    return
  }
  result.ids.forEach((id, i) => {
    filamentAssignments[i] = id
    const choice = id ? findFilament(id) : undefined
    if (choice) setPaletteColor(i, { ...choice.color.rgb }, false)
  })
  rebuildNow(false)
  renderPalette()
  const missed = result.ids.filter((id) => !id).length
  showStatus(missed ? tr('autoPickDoneWithGaps', { n: String(missed) }) : tr('autoPickDone'))
  noteSettled()
})

/**
 * Apply a worker rebuild result to the live editor state. Stale responses
 * (a newer reprocess, or a newer editor mutation since the request was sent)
 * are ignored — the coalescing pump always sends the latest state next.
 */
function applyWorkerResult(r: WorkerResult, token: number, version: number) {
  if (!current || token !== runToken || version !== stateVersion) {
    // A newer reprocess or editor mutation superseded this rebuild.
    perf.recordDiscarded('rebuild')
    renderPerf()
    return
  }
  current.settings = r.settings
  current.darkIsTall = r.darkIsTall
  current.palette = r.palette
  current.quantized.palette = r.quantized.palette
  current.quantized.bandHeightsMm = r.quantized.bandHeightsMm
  current.field = r.field
  current.mesh = r.mesh
  drawQuantized()
  drawLayerView()
  update3d()
  renderPrintability()
  scheduleSettle()
}

setResultListener((r, token, version) => applyWorkerResult(r, token, version))

/** Rebuild geometry in the worker from the current editor state (coalesced). */
function rebuildNow(final = true) {
  if (!current) return
  const token = runToken
  const version = ++stateVersion
  const t0 = performance.now()
  void rebuildInWorker({
    opts: readOptions(),
    palette: current.quantized.palette.map((c) => ({ ...c })),
    token,
    version,
  })
    .then((r) => {
      perf.recordRebuild(performance.now() - t0)
      perf.recordMesh(r.mesh.triangleCount)
      renderPerf()
      if (token === runToken && version === stateVersion && final) updateUI()
    })
    .catch((err: unknown) => {
      if (token === runToken) showStatus(err instanceof Error ? err.message : String(err), true)
    })
}

/** One row of the filament-library popover: a <select> for one axis. */
function librarySelect(
  labelText: string,
  options: { value: string; label: string }[],
  value: string,
  onChange: (v: string) => void,
): HTMLLabelElement {
  const label = document.createElement('label')
  label.className = 'filam-lib-field'
  const span = document.createElement('span')
  span.textContent = labelText
  const select = document.createElement('select')
  for (const opt of options) {
    const o = document.createElement('option')
    o.value = opt.value
    o.textContent = opt.label
    select.appendChild(o)
  }
  select.value = value
  select.addEventListener('change', () => onChange(select.value))
  label.append(span, select)
  return label
}

/**
 * Filament-library popover for one palette slot: pick brand → material →
 * color from the Russian-manufacturer library, or clear back to the
 * nearest-suggestion fallback.
 */
function openLibraryPopover(slotIdx: number, anchor: HTMLElement) {
  closeLibraryPopover()
  const pop = document.createElement('div')
  pop.className = 'filam-pop'
  pop.id = 'filam-pop'

  const title = document.createElement('div')
  title.className = 'filam-pop-title'
  title.textContent = tr('filamLibraryTitle')
  const hint = document.createElement('div')
  hint.className = 'filam-pop-hint'
  hint.textContent = tr('filamLibraryHint')
  pop.append(title, hint)

  const choice = filamentForSlot(slotIdx)
  let brandId = choice.brandId
  let materialId = choice.materialId

  const colorPreview = document.createElement('div')
  colorPreview.className = 'filam-pop-color'
  const colorSwatch = document.createElement('span')
  colorSwatch.className = 'filam-pop-swatch'
  const colorName = document.createElement('span')
  colorName.className = 'filam-pop-colorname'

  /** Inline "add own filament" form (visible only in the My brand). */
  const addForm = document.createElement('div')
  addForm.className = 'filam-add-form'
  addForm.hidden = true
  const addName = document.createElement('input')
  addName.type = 'text'
  addName.className = 'filam-add-name'
  addName.placeholder = tr('filamAddNamePlaceholder')
  addName.ariaLabel = tr('filamAddName')
  addName.maxLength = 40
  const addColor = document.createElement('input')
  addColor.type = 'color'
  addColor.className = 'filam-add-color'
  addColor.value = '#cc2222'
  addColor.ariaLabel = tr('filamAddColor')
  const addBtn = document.createElement('button')
  addBtn.type = 'button'
  addBtn.className = 'filam-add-btn'
  addBtn.textContent = tr('filamAddBtn')
  addForm.append(addName, addColor, addBtn)

  const myEmpty = document.createElement('div')
  myEmpty.className = 'filam-my-empty'
  myEmpty.textContent = tr('filamMyEmpty')

  const rebuild = (keepColor: boolean) => {
    const isMy = brandId === CUSTOM_BRAND_ID
    addForm.hidden = !isMy
    myEmpty.hidden = !isMy || customFilaments().length > 0

    // The visible list: catalog colors for a real brand, customs for My.
    let choices: { id: string; hex: string; name: string; custom?: boolean }[]
    if (isMy) {
      choices = customFilaments()
        .filter((f) => f.materialId === materialId)
        .map((f) => ({ id: f.id, hex: f.hex, name: lang === 'ru' ? f.nameRu : f.nameEn, custom: true }))
    } else {
      const material = LIBRARY[brandId][materialId]
      choices = material.colors.map((c) => ({ id: c.id, hex: c.hex, name: lang === 'ru' ? c.nameRu : c.nameEn }))
    }
    const ids = new Set(choices.map((c) => c.id))
    if (!keepColor || !ids.has(pop.dataset.colorId ?? '')) {
      pop.dataset.colorId = choices[0]?.id ?? ''
    }
    const current = choices.find((c) => c.id === pop.dataset.colorId)
    colorPreview.replaceChildren()
    if (current) {
      colorSwatch.style.background = current.hex
      colorName.textContent = current.name
      colorPreview.append(colorSwatch, colorName)
    }
    grid.replaceChildren()
    for (const c of choices) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'filam-grid-btn'
      btn.title = c.name
      btn.ariaLabel = `${brandId} ${materialId} ${c.name}`
      const sw = document.createElement('span')
      sw.className = 'filam-grid-swatch'
      sw.style.background = c.hex
      btn.appendChild(sw)
      if (c.id === pop.dataset.colorId) btn.classList.add('active')
      if (c.custom) {
        btn.classList.add('custom')
        const del = document.createElement('span')
        del.className = 'filam-grid-del'
        del.textContent = '✕'
        del.title = tr('filamDelete')
        del.ariaLabel = tr('filamDelete')
        del.addEventListener('click', (ev) => {
          ev.stopPropagation()
          if (!confirm(tr('filamDeleteConfirm'))) return
          removeCustomFilament(c.id)
          if (filamentAssignments.includes(c.id)) {
            filamentAssignments = filamentAssignments.map((a) => (a === c.id ? null : a))
          }
          rebuild(false)
          renderPalette()
        })
        btn.appendChild(del)
      }
      btn.addEventListener('click', () => {
        pop.dataset.colorId = c.id
        commit()
      })
      grid.appendChild(btn)
    }
  }

  const commit = () => {
    const fullId = pop.dataset.colorId
    if (!fullId) return
    filamentAssignments[slotIdx] = fullId
    const c = findFilament(fullId)
    if (!c) return
    // Adopt the catalog color so the preview/print matches the real plastic.
    setPaletteColor(slotIdx, { ...c.color.rgb })
    renderPalette()
    closeLibraryPopover()
  }

  addBtn.addEventListener('click', () => {
    const hex = /^#[0-9a-f]{6}$/i.test(addColor.value) ? addColor.value : '#888888'
    const added = addCustomFilament({ name: addName.value, hex, materialId: materialId as MaterialId })
    brandId = CUSTOM_BRAND_ID
    pop.dataset.colorId = added.id
    rebuild(false)
    commit()
  })

  const brandField = librarySelect(
    tr('filamBrandLabel'),
    [{ value: CUSTOM_BRAND_ID, label: tr('filamMyBrand') }, ...BRANDS.map((b) => ({ value: b.id, label: b.name }))],
    brandId,
    (v) => {
      brandId = v
      rebuild(false)
    },
  )
  const materialField = librarySelect(
    tr('filamMaterialLabel'),
    MATERIALS.map((m) => ({ value: m, label: materialName(m) })),
    materialId,
    (v) => {
      materialId = v as typeof materialId
      rebuild(false)
    },
  )
  const colorField = document.createElement('div')
  colorField.className = 'filam-lib-field'
  const colorLabel = document.createElement('span')
  colorLabel.textContent = tr('filamColorLabel')
  colorField.append(colorLabel)

  const grid = document.createElement('div')
  grid.className = 'filam-grid'

  const clearBtn = document.createElement('button')
  clearBtn.type = 'button'
  clearBtn.className = 'filam-clear'
  clearBtn.textContent = tr('filamClear')
  clearBtn.addEventListener('click', () => {
    filamentAssignments[slotIdx] = null
    renderPalette()
    closeLibraryPopover()
  })

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'filam-close'
  closeBtn.textContent = '✕'
  closeBtn.title = tr('filamClose')
  closeBtn.ariaLabel = tr('filamClose')
  closeBtn.addEventListener('click', closeLibraryPopover)

  pop.append(closeBtn, brandField, materialField, colorField, colorPreview, grid, addForm, myEmpty, clearBtn)
  document.body.appendChild(pop)
  rebuild(true)

  // Position next to the anchor, clamped to the viewport.
  const r = anchor.getBoundingClientRect()
  pop.style.visibility = 'hidden'
  requestAnimationFrame(() => {
    const pw = pop.offsetWidth
    const ph = pop.offsetHeight
    const left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8))
    const top = Math.min(r.bottom + 6, window.innerHeight - ph - 8)
    pop.style.left = `${left}px`
    pop.style.top = `${top}px`
    pop.style.visibility = ''
  })
  activePopSlot = slotIdx
}

let activePopSlot: number | null = null
let popAnchor: HTMLElement | null = null

function closeLibraryPopover() {
  document.getElementById('filam-pop')?.remove()
  activePopSlot = null
  popAnchor = null
}

/** Close the popover on any outside click. */
document.addEventListener('click', (e) => {
  const pop = document.getElementById('filam-pop')
  if (!pop) return
  if (pop.contains(e.target as Node) || popAnchor?.contains(e.target as Node)) return
  closeLibraryPopover()
})

/** Collapse the palette panel to just the coverage bar (saved across sessions). */
const PALETTE_COLLAPSED_KEY = 'hf-palette-collapsed'

/** Update the «N colors» note shown in the head while collapsed. */
function syncPaletteCollapsedNote() {
  const note = document.getElementById('palette-collapsed-note')
  const body = document.getElementById('palette-body')
  const btn = document.getElementById('palette-collapse')
  if (!note || !body || !btn) return
  const collapsed = body.classList.contains('is-collapsed')
  btn.title = tr(collapsed ? 'paletteExpand' : 'paletteCollapse') // follows language switches
  note.hidden = !collapsed || !current
  if (note.hidden) return
  note.textContent = tr('paletteCollapsedNote', {
    n: word(lang, current!.quantized.palette.length, 'colors'),
  })
}

function setPaletteCollapsed(collapsed: boolean, persist = true) {
  const body = document.getElementById('palette-body')
  const btn = document.getElementById('palette-collapse')
  if (!body || !btn) return
  body.classList.toggle('is-collapsed', collapsed)
  btn.classList.toggle('is-collapsed', collapsed)
  btn.ariaExpanded = String(!collapsed)
  btn.title = tr(collapsed ? 'paletteExpand' : 'paletteCollapse')
  if (persist) {
    try { localStorage.setItem(PALETTE_COLLAPSED_KEY, collapsed ? '1' : '0') } catch { /* private mode */ }
  }
  syncPaletteCollapsedNote()
}

function renderPalette() {
  const palette = current!.palette
  paletteList.innerHTML = ''
  // Area share of each palette color (post-dither, post-cleanup — exactly
  // what will be printed); indexMap indexes quantized.palette 1:1 with rows.
  const shares = colorShares(current!.quantized.indexMap, palette.length)
  renderCoverage(shares, palette)
  syncPaletteCollapsedNote() // collapsed note tracks the live color count
  // Sheet thickness per print order, from the snapped band tops: a band's
  // thickness is the gap between its top and the band below it (the base for
  // the first band). Heights never change on color edits, so compute once.
  const thicknessByOrder = new Map<number, { mm: number; layers: number }>()
  const sorted = [...palette].sort((a, b) => a.topZMm - b.topZMm)
  let prevTop = current!.settings.baseMm
  for (const e of sorted) {
    const mm = e.topZMm - prevTop
    const layers = Math.max(1, Math.round(mm / current!.settings.layerMm))
    thicknessByOrder.set(e.printOrder, { mm, layers })
    prevTop = e.topZMm
  }
  for (let i = 0; i < palette.length; i++) {
    const entry = palette[i]
    const row = document.createElement('div')
    row.className = 'palette-row'
    // Two-line layout: controls on the first line, the full-width info
    // line below (mm/layers/share/τ) — it never fits beside the controls
    // in a 300 px panel and overflowed under the slider.
    const rowMain = document.createElement('div')
    rowMain.className = 'palette-row-main'

    // Native color picker styled as a swatch; live previews while dragging.
    const picker = document.createElement('input')
    picker.type = 'color'
    picker.className = 'palette-picker'
    picker.value = rgbToHex(entry.color)
    picker.title = tr('paletteChange')
    picker.ariaLabel = tr('paletteChange')

    const label = document.createElement('span')
    label.className = 'palette-label'
    const labelMain = document.createElement('span')
    labelMain.className = 'palette-label-main'
    const labelSub = document.createElement('span')
    labelSub.className = 'palette-label-sub'
    // Read the live palette entry (current.palette[i]) rather than the stale
    // `entry` captured above, so the label tracks live color edits too.
    const choice = filamentForSlot(i)
    const labelText = () => {
      const live = current!.palette[i]
      const filam = ` · ${filamentLabel(filamentForSlot(i))}`
      return `#${live.printOrder} · ${rgbToHex(live.color)} · ~${nearestFilament(live.color, lang)}${filam}`
    }
    const subText = () => {
      const live = current!.palette[i]
      const t = thicknessByOrder.get(live.printOrder)
      const sharePart = ` · ${formatShare(shares[i].percent)}`
      const tauPart = ` · τ ${tauOfSlot(i).toFixed(2)} mm`
      return t ? `${mmOf(lang, t.mm)} · ${word(lang, t.layers, 'layers')}${sharePart}${tauPart}` : `${sharePart}${tauPart}`
    }
    // Full details also ride on the row tooltip: the info line truncates
    // with ellipsis in a narrow panel, so hovering must reveal everything
    // (native tooltips render \n as a line break).
    const syncLabel = () => {
      const main = labelText()
      const sub = subText()
      labelMain.textContent = main
      labelSub.textContent = sub
      label.title = `${main}\n${sub}`
    }
    syncLabel()
    label.append(labelMain, labelSub)

    // Filament-library button: pick a real catalog plastic for this band.
    const libBtn = document.createElement('button')
    libBtn.type = 'button'
    libBtn.className = 'palette-lib'
    libBtn.textContent = filamentAssignments[i] ? '★' : '☆'
    libBtn.title = `${tr('filamPick')} — ${filamentLabel(choice)}`
    libBtn.ariaLabel = `${tr('filamPick')} — ${filamentLabel(choice)}`
    libBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (activePopSlot === i) {
        closeLibraryPopover()
        return
      }
      popAnchor = libBtn
      openLibraryPopover(i, libBtn)
    })

    // Per-filament opacity length τ (mm) — fitted from a calibration swatch
    // or set by hand; drives the translucent preview blends.
    const tauInput = document.createElement('input')
    tauInput.type = 'number'
    tauInput.className = 'palette-tau'
    tauInput.min = '0.2'
    tauInput.max = '6'
    tauInput.step = '0.1'
    tauInput.value = tauOfSlot(i).toFixed(2)
    tauInput.title = tr('paletteTau')
    tauInput.ariaLabel = `${tr('paletteTau')} — #${entry.printOrder}`
    tauInput.addEventListener('input', () => {
      const v = Number(tauInput.value)
      if (!current || !Number.isFinite(v) || v <= 0) return
      current.quantized.tauMm![i] = Math.min(6, Math.max(0.2, v))
      drawQuantized()
      drawLayerView()
      syncLabel()
      scheduleSettle()
    })

    // Per-band sheet thickness (HueForge-style): this slider sets the band's
    // thickness in mm; the total model height becomes base + Σh while any
    // custom heights are active (the max-height input turns read-only).
    const heightSlider = document.createElement('input')
    heightSlider.type = 'range'
    heightSlider.className = 'palette-height'
    heightSlider.min = '0.1'
    heightSlider.max = '10'
    heightSlider.step = '0.05'
    heightSlider.value = String(bandThicknessForSlot(i))
    heightSlider.title = tr('paletteHeight')
    heightSlider.ariaLabel = `${tr('paletteHeight')} — #${entry.printOrder}`
    const heightVal = document.createElement('span')
    heightVal.className = 'palette-height-val'
    heightVal.textContent = bandThicknessForSlot(i).toFixed(2)
    heightSlider.addEventListener('input', () => {
      if (!current) return
      const baseMm = Number(baseInput.value) || 0.8
      // First touch seeds custom mode from equal shares so the total doesn't
      // jump while the user starts adjusting one band.
      if (!bandHeights || bandHeights.length !== current.quantized.palette.length) {
        const usable = current.settings.maxHeightMm - current.settings.baseMm
        const share = Number((usable / current.quantized.palette.length).toFixed(2))
        bandHeights = current.quantized.palette.map(() => Math.min(10, Math.max(0.1, share)))
        syncMaxInput()
      }
      const others = bandHeights.reduce((a, c, idx) => (idx === i ? a : a + c), 0)
      const v = Math.min(10, Math.max(0.1, Number(heightSlider.value)))
      const clamped = Math.max(0.1, Math.min(v, 40 - baseMm - others))
      bandHeights[i] = Number(clamped.toFixed(2))
      heightSlider.value = String(bandHeights[i])
      heightVal.textContent = bandHeights[i].toFixed(2)
      syncMaxInput()
      applyBandHeights()
    })
    heightSlider.addEventListener('change', () => {
      updateUI()
      saveSettings()
    })

    // Restore the auto-quantized color for this entry.
    const reset = document.createElement('button')
    reset.type = 'button'
    reset.className = 'palette-reset'
    reset.textContent = '↺'
    reset.title = tr('paletteReset')
    reset.ariaLabel = tr('paletteReset')
    reset.addEventListener('click', () => {
      const auto = autoPalette[i]
      if (!auto) return
      picker.value = rgbToHex(auto)
      setPaletteColor(i, { ...auto })
      syncLabel()
      libBtn.textContent = filamentAssignments[i] ? '★' : '☆'
    })

    // Live: update previews/3D only, keep the open picker alive.
    picker.addEventListener('input', () => {
      setPaletteColor(i, hexToRgb(picker.value), false)
      // Manual color edits release the catalog assignment: the band now has
      // its own color and the library falls back to the nearest suggestion.
      if (filamentAssignments[i]) {
        filamentAssignments[i] = null
        libBtn.textContent = '☆'
      }
      syncLabel()
    })
    // Commit: full re-render (palette list, printability, status).
    picker.addEventListener('change', () => {
      setPaletteColor(i, hexToRgb(picker.value))
      showStatus(tr('ready', { colors: word(lang, current!.quantized.palette.length, 'colors') }))
    })

    rowMain.append(picker, heightSlider, heightVal, tauInput, libBtn, reset)
    row.append(rowMain, label)
    paletteList.appendChild(row)
  }
  paletteSummary.textContent = tr('paletteSummary', { colors: word(lang, palette.length, 'colors') })
  // Flag spools that barely appear in the print (<1% of the area) so a
  // wasted color change is visible before slicing. Same threshold as the
  // drop button, so the summary and the action always agree.
  const lowUseThreshold = clampNum(Number(dropSparseThreshold.value), 0.1, 10, 1)
  const lowUse = palette
    .map((e, i) => ({ order: e.printOrder, percent: shares[i].percent }))
    .filter((s) => s.percent < lowUseThreshold)
    .sort((a, b) => a.percent - b.percent)
    .map((s) => `#${s.order} ${formatShare(s.percent)}`)
  if (lowUse.length) {
    paletteSummary.textContent += ` ${tr('paletteLowUse', { list: lowUse.join(', ') })}`
    paletteSummary.title = tr('paletteLowUseHelp')
  } else {
    paletteSummary.title = ''
  }
  // The one-click cleanup stays visible in catalog mode (discoverability);
  // it disables itself when there is nothing to drop. Outside catalog mode
  // dropping a spool is meaningless, so the whole group hides. The
  // threshold (share below which a spool counts as "barely used") is
  // user-editable in percent, default 1%.
  const dropThreshold = clampNum(Number(dropSparseThreshold.value), 0.1, 10, 1) / 100
  const droppable = catalogActive
    ? current!.quantized.indexMap
      ? colorShares(current!.quantized.indexMap, palette.length).filter((s) => s.share < dropThreshold).length
      : 0
    : 0
  dropSparseWrap.hidden = !catalogActive
  dropSparseBtn.disabled = !(catalogActive && droppable > 0 && palette.length > 2)
  const dropSparseLabel = dropSparseBtn.querySelector('[data-i18n]')
  if (dropSparseLabel) {
    dropSparseLabel.textContent = droppable > 0
      ? `${tr('dropSparse')} (${droppable})`
      : tr('dropSparse')
  }
  if (dropSparseBtn.disabled) dropSparseBtn.title = tr('dropSparseNone')
  else {
    const sharesFull = colorShares(current!.quantized.indexMap, palette.length)
    const sparseIdx = sharesFull.map((s, i) => ({ s, i })).filter((x) => x.s.share < dropThreshold).map((x) => x.i)
    const detail = sparseIdx
      .map((i) => `#${palette[i].printOrder} ${formatShare(sharesFull[i].percent)}`)
      .join(', ')
    // Mini-scheme: which surviving color absorbs each dropped one.
    const targets = dropTargets(palette.map((e) => e.color), palette.map((_, i) => !sparseIdx.includes(i)))
    const moves = sparseIdx
      .filter((i) => targets.has(i))
      .map((i) => {
        const t = targets.get(i)!
        return `#${palette[i].printOrder} → #${palette[t].printOrder} (${lang === 'ru' ? 'станет' : 'becomes'} ${formatShare(sharesFull[t].percent + sharesFull[i].percent)})`
      })
      .join(', ')
    dropSparseBtn.title = `${tr('dropSparseHelp')} ${tr('dropSparseList', { list: detail })}${moves ? ` ${tr('dropSparseMoves', { list: moves })}` : ''}`
  }
  // Shopping list is meaningful once any slot has a real filament.
  shoppingListBtn.disabled = !current || filamentAssignments.every((id) => !id)
  updateCatalogBtn()
  // Keep assignments aligned with the (possibly changed) color count.
  filamentAssignments.length = palette.length
  for (let i = 0; i < palette.length; i++) filamentAssignments[i] ??= null
  // Calibration color picker follows the palette rows (keep the selection).
  const prevCalib = calibColor.value
  calibColor.replaceChildren()
  palette.forEach((e, idx) => {
    const opt = document.createElement('option')
    opt.value = String(idx)
    opt.textContent = `#${e.printOrder} · ${rgbToHex(e.color)}`
    calibColor.appendChild(opt)
  })
  if ([...calibColor.options].some((o) => o.value === prevCalib)) calibColor.value = prevCalib
}

function cubeFaceLabels(): Record<FaceName, string> {
  return {
    top: tr('faceTop'),
    bottom: tr('faceBottom'),
    front: tr('faceFront'),
    back: tr('faceBack'),
    right: tr('faceRight'),
    left: tr('faceLeft'),
  }
}

function update3d() {
  if (!viewer3d) {
    viewer3d = new Viewer3D(viewerEl, document.getElementById('cube-overlay') ?? undefined)
    ;(window as unknown as { __viewer3d?: Viewer3D }).__viewer3d = viewer3d
    viewer3d.setFaceLabels(cubeFaceLabels())
    const homeBtn = document.getElementById('viewer-home')
    homeBtn?.addEventListener('click', () => viewer3d?.goHome())
    const topBtn = document.getElementById('viewer-top')
    topBtn?.addEventListener('click', () => viewer3d?.setTopDown(!viewer3d.topDown))
    if (viewer3d) viewer3d.onTopDownChange = (on) => topBtn?.classList.toggle('is-active', on)
    for (const b of document.querySelectorAll<HTMLButtonElement>('#viewer3d-modes button')) {
      b.addEventListener('click', () => setViewer3dMode(b.dataset.mode as 'model' | 'deltae' | 'slice'))
    }
  }
  const w = current!.settings.widthMm
  const h = current!.settings.heightMm
  viewer3d.setBackground(THEME_VIEWER_BG[document.documentElement.dataset.theme ?? 'dark'] ?? THEME_VIEWER_BG.dark)
  viewer3d.setMesh(current!.mesh, { wMm: w, hMm: h })
  // Dimensions caption: actual height = tallest band top (base + sheets),
  // matching what the mesh and the exported file contain.
  const z = Math.max(...current!.palette.map((e) => e.topZMm))
  const fmt = (v: number) => String(parseFloat(v.toFixed(2)))
  dimsEl.textContent = tr('viewer3dDims', { w: fmt(w), h: fmt(h), z: fmt(z) })
  viewer3d.setPrinterBed(bedSizeFor(printerSelect.value))
  // Re-apply the active analysis mode to the fresh geometry.
  if (viewer3dMode === 'deltae') applyDeltaETo3d()
  else if (viewer3dMode === 'slice') applySliceTo3d()
}

/** Fill the printer-bed selector (call again on language change for labels). */
function fillPrinterSelect() {
  const prev = printerSelect.value || localStorage.getItem('hf-printer') || PRINTER_NONE
  printerSelect.replaceChildren()
  const none = document.createElement('option')
  none.value = PRINTER_NONE
  none.textContent = tr('printerNone')
  printerSelect.appendChild(none)
  for (const p of PRINTERS) {
    const opt = document.createElement('option')
    opt.value = p.id
    opt.textContent = `${p.name} — ${p.bedX}×${p.bedY}`
    printerSelect.appendChild(opt)
  }
  printerSelect.value = findPrinterOption(prev)
  printerSelect.title = tr('printerHelp')
}

function findPrinterOption(id: string): string {
  return [...printerSelect.options].some((o) => o.value === id) ? id : PRINTER_NONE
}

printerSelect.addEventListener('change', () => {
  try { localStorage.setItem('hf-printer', printerSelect.value) } catch { /* private mode */ }
  viewer3d?.setPrinterBed(bedSizeFor(printerSelect.value))
})

/** Active 3D analysis mode ('model' = plain filament colors). */
let viewer3dMode: 'model' | 'deltae' | 'slice' = 'model'

/**
 * Compute the per-cell ΔE error (same values the 2D map shows) and hand
 * them to the 3D viewer as a heatmap over the top surface.
 */
function applyDeltaETo3d() {
  if (!viewer3d || !current) return
  const { width, height, indexMap, palette } = current.quantized
  viewer3d.setDeltaEMap(deltaEField(), width, height, indexMap, palette)
}

/** Push the current layer-view position into the 3D slice mode. */
function applySliceTo3d() {
  if (!viewer3d || !current) return
  const total = Math.max(1, Math.round(current.settings.maxHeightMm / current.settings.layerMm))
  const l = Math.round(layerPos * (total - 1)) + 1
  // One filament per layer: tint the slice cap with the band printed at z.
  const { activeBand } = layerView(current, l * current.settings.layerMm)
  const n = current.quantized.palette.length
  const entry = current.palette.find((p) => (current!.settings.darkIsTall ? n - p.printOrder : p.printOrder - 1) === activeBand)
  viewer3d.setSlice(l * current.settings.layerMm, entry ? rgbToHex(entry.color) : undefined)
}

/** Switch the 3D viewer's analysis mode and keep the UI in step. */
function setViewer3dMode(mode: 'model' | 'deltae' | 'slice') {
  viewer3dMode = mode
  const group = document.getElementById('viewer3d-modes')
  for (const b of group?.querySelectorAll<HTMLButtonElement>('button') ?? []) {
    b.classList.toggle('is-active', b.dataset.mode === mode)
  }
  // The layer slider only means something in slice mode — show it there.
  const controls = document.querySelector<HTMLElement>('#viewer-3d .layer-controls')
  if (controls) controls.hidden = mode !== 'slice'
  if (!viewer3d || !current) return
  if (mode === 'deltae') {
    applyDeltaETo3d()
    viewer3d.setSlice(null)
  } else if (mode === 'slice') {
    viewer3d.clearDeltaEOverlay()
    applySliceTo3d()
  } else {
    viewer3d.clearDeltaEOverlay()
    viewer3d.setSlice(null)
  }
}

// ---- Per-filament opacity calibration (swatch print + photo fit) ---------

/** Photo-derived sample of the bare base area (absorbs exposure). */
let calibBase: RGB | null = null
/** Sampled steps, thin → thick, one per CALIB_STEPS entry. */
let calibSamples: CalibSample[] = []

/** Palette slot of the print's base color (sheet 0 — the opaque backdrop). */
function baseSlotIndex(): number {
  const n = current!.quantized.palette.length
  return current!.settings.darkIsTall ? n - 1 : 0
}

/** Mean RGB of a small square around the click point on the photo canvas. */
function sampleMean(canvas: HTMLCanvasElement, cx: number, cy: number, radius: number): RGB {
  const ctx = canvas.getContext('2d')!
  const x0 = Math.max(0, Math.round(cx - radius))
  const y0 = Math.max(0, Math.round(cy - radius))
  const w = Math.min(canvas.width - x0, 2 * radius + 1)
  const h = Math.min(canvas.height - y0, 2 * radius + 1)
  const d = ctx.getImageData(x0, y0, w, h).data
  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]
    g += d[i + 1]
    b += d[i + 2]
  }
  const cnt = d.length / 4
  return { r: Math.round(r / cnt), g: Math.round(g / cnt), b: Math.round(b / cnt) }
}

calibDownload.addEventListener('click', () => {
  if (!current) return
  const slot = Number(calibColor.value)
  const color = current.quantized.palette[slot]
  const base = current.quantized.palette[baseSlotIndex()]
  const sw = buildCalibrationSwatch(color, rgbToHex(base), current.settings.layerMm)
  const name = `hueforge-calib-${rgbToHex(color).slice(1)}`
  triggerDownload(sw.stl as unknown as BlobPart, `${name}.stl`, 'model/stl')
  triggerDownload(sw.info, `${name}.txt`, 'text/plain;charset=utf-8')
  showStatus(tr('calibDownloadDone', { filename: `${name}.stl` }))
})

calibPhoto.addEventListener('change', () => {
  const file = calibPhoto.files?.[0]
  if (!file || !current) return
  const img = new Image()
  img.onload = () => {
    calibBase = null
    calibSamples = []
    const scale = Math.min(1, 420 / img.width)
    calibCanvas.width = Math.max(1, Math.round(img.width * scale))
    calibCanvas.height = Math.max(1, Math.round(img.height * scale))
    calibCanvas.getContext('2d')!.drawImage(img, 0, 0, calibCanvas.width, calibCanvas.height)
    calibCanvas.hidden = false
    calibStatus.textContent = tr('calibClickBase')
    URL.revokeObjectURL(img.src)
  }
  img.src = URL.createObjectURL(file)
})

calibCanvas.addEventListener('click', (e) => {
  if (!current || calibCanvas.hidden) return
  const rect = calibCanvas.getBoundingClientRect()
  const cx = ((e.clientX - rect.left) / rect.width) * calibCanvas.width
  const cy = ((e.clientY - rect.top) / rect.height) * calibCanvas.height
  const rgb = sampleMean(calibCanvas, cx, cy, 8)
  if (!calibBase) {
    calibBase = rgb
    calibStatus.textContent = tr('calibClickStep', {
      n: 1,
      total: CALIB_STEPS.length,
      t: CALIB_STEPS[0].toFixed(2),
    })
    return
  }
  const idx = calibSamples.length
  calibSamples.push({ thicknessMm: CALIB_STEPS[idx], rgb })
  if (calibSamples.length < CALIB_STEPS.length) {
    calibStatus.textContent = tr('calibClickStep', {
      n: idx + 2,
      total: CALIB_STEPS.length,
      t: CALIB_STEPS[idx + 1].toFixed(2),
    })
    return
  }
  // All steps sampled — fit τ for the selected slot and refresh previews.
  const slot = Number(calibColor.value)
  initTau(current.quantized)
  const tau = fitTau(
    calibSamples,
    calibBase,
    current.quantized.palette[baseSlotIndex()],
    current.quantized.palette[slot],
  )
  current.quantized.tauMm![slot] = tau
  drawQuantized()
  drawLayerView()
  renderPalette()
  calibStatus.textContent = tr('calibFitDone', { tau: tau.toFixed(2) })
  scheduleSettle()
})

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
    // A new image is a fresh load: print size refits to its aspect ratio.
    if (f) void readFile(f, true)
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
    if (f) void readFile(f, true)
  })
}

function bindInputs() {
  for (const el of document.querySelectorAll<HTMLInputElement>(
    'input[name="mode"], #width-mm, #height-mm, #base-mm, #max-mm, #layer-mm',
  )) {
    el.addEventListener('change', () => {
      saveSettings()
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
  colorsSlider.addEventListener('change', () => {
    flushReprocess()
    saveSettings()
  })
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

  // Dithering: debounced live reprocess on drag, flushed on release.
  ditherSlider.addEventListener('input', () => {
    ditherValue.textContent = `${ditherSlider.value}%`
    scheduleReprocess()
  })
  ditherSlider.addEventListener('change', () => {
    flushReprocess()
    saveSettings()
  })

  // ΔE merge: checkbox toggles the threshold input; both reprocess.
  mergeCheck.addEventListener('change', () => {
    syncMergeThreshold()
    scheduleReprocess()
    saveSettings()
  })
  mergeInput.addEventListener('change', () => {
    if (!mergeCheck.checked) return
    scheduleReprocess()
    saveSettings()
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
    // Match the range-input thumb travel: thumb center sits at thumbHalf +
    // fraction × (trackWidth − thumbWidth). Chromium/Edge default thumb = 16px.
    const frac = (v - SLIDER_MIN) / span
    tick.style.left = `calc(8px + ${frac} * (100% - 16px))`
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

// ---- Reference 3MF: analyze first, apply only by explicit action ----

let referenceAnalysis: Reference3mfAnalysis | null = null
let referencePlan: ReferenceApplyPlan | null = null

function currentEditorOptions() {
  const o = readOptions()
  return {
    numColors: o.numColors as number,
    darkIsTall: o.darkIsTall,
    widthMm: o.widthMm,
    heightMm: o.heightMm,
    baseMm: o.baseMm,
    maxHeightMm: o.maxHeightMm,
    layerMm: o.layerMm,
  }
}

function showRefError(code: string, fallback: string) {
  const key = `refErr${code.charAt(0).toUpperCase()}${code.slice(1)}`
  let message: string
  try {
    message = tr(key)
  } catch {
    message = fallback
  }
  refError.textContent = message
  refError.hidden = false
}

function setRefBadge(kind: 'empty' | 'ready' | 'complete' | 'partial' | 'error' | 'analyzing') {
  const keyMap = {
    empty: 'refBadgeEmpty',
    ready: 'refBadgeReady',
    complete: 'refBadgeComplete',
    partial: 'refBadgePartial',
    error: 'refBadgeError',
    analyzing: 'refBadgeAnalyzing',
  } as const
  refBadge.className = `ref-badge ${kind}`
  refBadge.dataset.kind = kind
  refBadge.dataset.i18n = keyMap[kind]
  refBadge.textContent = tr(keyMap[kind])
}

function resetReferenceUI() {
  refReport.hidden = true
  refError.hidden = true
  refApplyBtn.disabled = true
  refApplyNote.textContent = ''
}

function renderReferenceReport() {
  if (!referenceAnalysis) return
  const a = referenceAnalysis
  refEmpty.hidden = true
  refReport.hidden = false
  refError.hidden = true

  refStatus.textContent = a.status === 'complete' ? tr('refComplete') : tr('refPartial')
  refStatus.className = `ref-status ${a.status}`
  setRefBadge(a.status)
  refModelLine.textContent = tr('refModelLine', {
    w: parseFloat(a.model.widthMm.toFixed(2)),
    h: parseFloat(a.model.heightMm.toFixed(2)),
    z: parseFloat(a.model.maxHeightMm.toFixed(2)),
    tris: word(lang, a.model.triangleCount, 'tris'),
    unit: a.model.unit,
  })

  refPaletteEl.innerHTML = ''
  for (const entry of a.palette) {
    const row = document.createElement('div')
    row.className = 'ref-palette-row'
    const swatch = document.createElement('span')
    swatch.className = 'ref-swatch'
    swatch.style.background = entry.hex
    const label = document.createElement('span')
    label.className = 'ref-swatch-label'
    label.textContent = `#${entry.printOrder} · ${entry.hex}`
    row.append(swatch, label)
    refPaletteEl.appendChild(row)
  }

  if (a.swaps.length > 0) {
    refSwaps.innerHTML = ''
    for (const swap of a.swaps) {
      const line = document.createElement('div')
      line.textContent = tr('refSwapLine', {
        z: swap.topZMm.toFixed(2),
        layer: swap.layer !== undefined ? tr('refSwapLayer', { layer: swap.layer }) : '',
      })
      refSwaps.appendChild(line)
    }
  } else {
    refSwaps.textContent = tr('refNoSwaps')
  }

  if (a.missingFields.length > 0) {
    refMissingSection.hidden = false
    refMissing.textContent = a.missingFields.join(' · ')
  } else {
    refMissingSection.hidden = true
  }

  if (a.warnings.length > 0) {
    refWarningsSection.hidden = false
    refWarningsEl.innerHTML = ''
    for (const w of a.warnings) {
      const item = document.createElement('div')
      item.textContent = w
      refWarningsEl.appendChild(item)
    }
  } else {
    refWarningsSection.hidden = true
  }

  updateApplyButton()
}

function updateApplyButton() {
  if (!referencePlan || !referencePlan.canApply) {
    refApplyBtn.disabled = true
    refApplyNote.textContent = referenceAnalysis && !current
      ? tr('refNeedsImage')
      : referencePlan?.blockedReason ?? ''
    return
  }
  if (!current) {
    refApplyBtn.disabled = true
    refApplyNote.textContent = tr('refNeedsImage')
    return
  }
  refApplyBtn.disabled = false
  refApplyNote.textContent = ''
}

async function analyzeReference(file: File) {
  resetReferenceUI()
  refStatus.className = 'ref-status'
  refStatus.textContent = tr('refAnalyzing')
  refReport.hidden = false
  setRefBadge('analyzing')
  try {
    referenceAnalysis = await parseReference3mf(file)
    referencePlan = planReferenceApply(referenceAnalysis, currentEditorOptions())
    renderReferenceReport()
  } catch (err) {
    referenceAnalysis = null
    referencePlan = null
    refReport.hidden = true
    setRefBadge('error')
    if (err instanceof Reference3mfParseError) {
      showRefError(err.code, err.message)
    } else {
      refError.textContent = tr('refError')
      refError.hidden = false
    }
  }
}

async function applyReference() {
  if (!referencePlan || !referencePlan.canApply) return
  if (!current || !currentFile) return
  const plan = referencePlan
  const o = plan.options
  // Load the reference values into the shared controls (persisted like
  // manual edits), then rebuild from the current image with overrides.
  colorsSlider.value = String(o.numColors)
  colorsValue.value = String(o.numColors)
  renderTicks()
  const modeInput = document.querySelector<HTMLInputElement>(`input[name="mode"][value="${o.darkIsTall ? 'dark' : 'light'}"]`)
  if (modeInput) modeInput.checked = true
  widthInput.value = String(o.widthMm)
  heightInput.value = String(o.heightMm)
  baseInput.value = String(o.baseMm)
  maxInput.value = String(o.maxHeightMm)
  layerInput.value = String(o.layerMm)
  saveSettings()

  const token = ++runToken
  showStatus(tr('processing'))
  setProcessing(true)
  try {
    const keepTau = current.quantized.tauMm
    const rgbaBytes = current.image.rgba.length
    const imgW = current.image.width
    const imgH = current.image.height
    const t0 = performance.now()
    const result = await quantizeInWorker(
      current.image.rgba.slice(),
      current.image.width,
      current.image.height,
      o,
      {
        palette: plan.paletteOverride ?? undefined,
        bandTops: plan.bandTopsOverride ?? undefined,
      },
    )
    perf.recordQuantize(performance.now() - t0)
    perf.recordBuffers({
      rgbaBytes,
      indexBytes: result.quantized.indexMap.length,
      fieldBytes: result.field.values.length * 4,
      width: imgW,
      height: imgH,
    })
    perf.recordMesh(result.mesh.triangleCount)
    renderPerf()
    if (token !== runToken) {
      perf.recordDiscarded('quantize')
      renderPerf()
      return
    }
    current = { ...result, image: current.image }
    initTau(current.quantized)
    // Keep fitted τ when the reference apply keeps the same color count.
    if (keepTau && keepTau.length === current.quantized.palette.length) {
      current.quantized.tauMm = keepTau
    }
    autoPalette = current.quantized.palette.map((c) => ({ ...c }))
    updateUI()
    setProcessing(false)
    showStatus(tr('refAppliedDone', { colors: word(lang, current.quantized.palette.length, 'colors') }))
    noteSettled()
  } catch (err) {
    if (token !== runToken) return false
    setProcessing(false)
    showStatus(err instanceof Error ? err.message : String(err), true)
  }
}

function setupReference() {
  refDrop.addEventListener('click', () => refInput.click())
  refInput.addEventListener('change', () => {
    const f = refInput.files?.[0]
    if (f) void analyzeReference(f)
  })
  refDrop.addEventListener('dragover', (e) => {
    e.preventDefault()
    refDrop.classList.add('dragover')
  })
  refDrop.addEventListener('dragleave', () => refDrop.classList.remove('dragover'))
  refDrop.addEventListener('drop', (e) => {
    e.preventDefault()
    refDrop.classList.remove('dragover')
    const f = e.dataTransfer?.files?.[0]
    if (f) void analyzeReference(f)
  })
  refApplyBtn.addEventListener('click', applyReference)
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
  btnDescribe.addEventListener('click', () => {
    if (!current) return
    const filename = exportFilename(current, 'txt')
    triggerDownload(describeExport(current, filename), filename, 'text/plain;charset=utf-8')
    showStatus(tr('describeDone', { filename }))
  })
  btnSlicer.addEventListener('click', () => {
    if (!current) return
    const filename = exportFilename(current, 'zip').replace(/\.zip$/, '-prusaslicer.zip')
    triggerDownload(buildSlicerBundle(current, filename.replace(/-prusaslicer\.zip$/, '.3mf')) as unknown as BlobPart, filename, 'application/zip')
    showStatus(tr('slicerDone', { filename }))
  })

  // ---- Project save/load (.hueforge.json) --------------------------------

  btnProjectSave.addEventListener('click', saveProject)
  btnProjectOpen.addEventListener('click', () => projectInput.click())
  projectInput.addEventListener('change', () => {
    const f = projectInput.files?.[0]
    if (f) void openProjectFile(f)
    projectInput.value = '' // allow re-opening the same file later
  })
}

/**
 * Serialize the current work into a portable .hueforge.json and download it:
 * the original image (data URL), all settings, and the palette — per-slot
 * hex, fitted τ, and the chosen filament (custom filaments embedded in full).
 */
function saveProject() {
  if (!current || !currentFile) return
  const reader = new FileReader()
  reader.onerror = () => showStatus(tr('projectSaveError'), true)
  reader.onload = () => {
    if (typeof reader.result !== 'string') return
    const n = current!.quantized.palette.length
    const darkIsTall = document.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value !== 'light'
    const palette = current!.quantized.palette.map((_, i) => captureSlotEntry(i))
    const opts = readOptions()
    const project = buildProjectFile({
      imageName: currentFile!.name,
      dataUrl: reader.result,
      settings: {
        colors: n,
        widthMm: opts.widthMm,
        heightMm: opts.heightMm,
        baseMm: opts.baseMm,
        maxMm: opts.maxHeightMm,
        layerMm: opts.layerMm,
        dither: opts.dither * 100,
        darkIsTall,
        backlight: lightBackBtn.classList.contains('is-active'),
        ...(bandHeights ? { bandHeightsMm: [...bandHeights] } : {}),
      },
      palette,
    })
    const filename = `${exportFilename(current!, '3mf').slice(0, -4)}${PROJECT_EXTENSION}`
    triggerDownload(JSON.stringify(project, null, 2), filename, 'application/json')
    showStatus(tr('projectSaved', { name: filename }))
  }
  reader.readAsDataURL(currentFile)
}

/** Apply a loaded project's settings to the controls (clamped), no reprocess. */
function applyProjectSettings(s: ProjectFile['settings']) {
  const clamp = (v: number, lo: number, hi: number, fb: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb)
  const baseMm = clamp(s.baseMm, 0, 5, 0.8)
  colorsSlider.value = String(Math.round(clamp(s.colors, SLIDER_MIN, SLIDER_MAX, 4)))
  colorsValue.value = colorsSlider.value
  ditherSlider.value = String(clamp(s.dither, 0, 100, 0))
  ditherValue.textContent = `${ditherSlider.value}%`
  if (s.mergeDeltaE !== undefined) {
    const on = s.mergeDeltaE > 0
    mergeCheck.checked = on
    if (on) mergeInput.value = String(clamp(Math.round(s.mergeDeltaE), 1, 40, 10))
    syncMergeThreshold()
  }
  widthInput.value = String(clamp(s.widthMm, 20, 500, 150))
  heightInput.value = String(clamp(s.heightMm, 20, 500, 150))
  baseInput.value = String(baseMm)
  maxInput.value = String(clamp(s.maxMm, baseMm + 2, 40, 8))
  layerInput.value = String(clamp(s.layerMm, 0.04, 0.6, 0.2))
  // Custom band heights restore as-is when the color count matches; any
  // mismatch (or a corrupt array) falls back to equal bands.
  const bh = s.bandHeightsMm
  bandHeights =
    bh && bh.length === Number(colorsSlider.value) && bh.every((h) => Number.isFinite(h) && h > 0)
      ? [...bh]
      : null
  syncMaxInput()
  const mode = document.querySelector<HTMLInputElement>(`input[name="mode"][value="${s.darkIsTall ? 'dark' : 'light'}"]`)
  if (mode) mode.checked = true
  setLightMode(s.backlight ? 'back' : 'front')
  renderTicks()
  saveSettings()
}

/**
 * Rebuild a File from an exported data URL. Decodes base64 directly instead
 * of fetching: the app's CSP keeps `data:` out of connect-src.
 */
function dataUrlToFile(dataUrl: string, name: string): File {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('bad data URL')
  const mime = /^data:([^;]+)/.exec(dataUrl.slice(0, comma))?.[1] ?? 'image/png'
  const bin = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name || 'image.png', { type: mime })
}

/**
 * Load a .hueforge.json: apply settings → restore the image through the
 * normal pipeline → overlay the saved palette (colors, τ, filaments) in one
 * finishPipeline pass.
 */
async function openProjectFile(file: File) {
  let project: ProjectFile
  try {
    project = parseProjectFile(await file.text())
  } catch (err) {
    const detail = err instanceof ProjectFileError ? err.message : String(err)
    showStatus(tr('projectInvalid', { detail }), true)
    return
  }
  applyProjectSettings(project.settings)
  let imageFile: File
  try {
    imageFile = dataUrlToFile(project.image.dataUrl, project.image.name)
  } catch {
    showStatus(tr('projectInvalid', { detail: 'image data URL' }), true)
    return
  }
  currentFile = imageFile
  const token = ++runToken
  showStatus(tr('processing'))
  setProcessing(true)
  try {
    const opts = readOptions()
    const { image } = await loadImageForPrint(imageFile, opts.widthMm, opts.heightMm, lang)
    const t0 = performance.now()
    const result = await quantizeInWorker(image.rgba.slice(), image.width, image.height, opts)
    perf.recordQuantize(performance.now() - t0)
    perf.recordBuffers({
      rgbaBytes: image.rgba.length,
      indexBytes: result.quantized.indexMap.length,
      fieldBytes: result.field.values.length * 4,
      width: image.width,
      height: image.height,
    })
    perf.recordMesh(result.mesh.triangleCount)
    renderPerf()
    if (token !== runToken) {
      perf.recordDiscarded('quantize')
      renderPerf()
      return
    }
    current = { ...result, image }
    initTau(current.quantized)
    autoPalette = result.quantized.palette.map((c) => ({ ...c }))
    // Overlay the saved palette in one pass.
    for (let i = 0; i < Math.min(project.palette.length, current.quantized.palette.length); i++) {
      const slot = project.palette[i]
      current.quantized.palette[i] = hexToRgb(slot.hex)
      current.quantized.tauMm![i] = Math.min(6, Math.max(0.2, slot.tauMm))
      if (slot.filament) {
        restoreCustomFilament({
          id: slot.filament.id,
          nameRu: slot.filament.nameRu,
          nameEn: slot.filament.nameEn,
          hex: slot.filament.hex,
          rgb: hexToRgb(slot.filament.hex),
          materialId: slot.filament.materialId as MaterialId,
        } satisfies CustomFilament)
        filamentAssignments[i] = slot.filament.id
      } else if (slot.filamentId && findFilament(slot.filamentId)) {
        filamentAssignments[i] = slot.filamentId
      } else {
        filamentAssignments[i] = null
      }
    }
    // Rebuild once more in the worker so the mesh colors carry the restored
    // palette; the result listener keeps the previews live meanwhile.
    const version = ++stateVersion
    await rebuildInWorker({
      opts: readOptions(),
      palette: current.quantized.palette.map((c) => ({ ...c })),
      token,
      version,
    })
    if (token !== runToken) return
    updateUI()
    setProcessing(false)
    showStatus(tr('projectLoaded', { name: project.image.name }))
    noteSettled()
  } catch (err) {
    if (token !== runToken) return false
    setProcessing(false)
    current = null
    btnStl.disabled = true
    btn3mf.disabled = true
    btnDescribe.disabled = true
    btnSlicer.disabled = true
    btnOpenSlicer.disabled = true
    btnProjectSave.disabled = true
    calibBlock.hidden = true
    printabilityList.innerHTML = ''
    printabilitySummary.textContent = tr('pbDefault')
    pbBadge.hidden = true
    showStatus(err instanceof Error ? err.message : String(err), true)
  }
}

// ---- Open in slicer (opt-in hand-off via the local server) ----------------

let slicerChoices: SlicerInfo[] = []

/**
 * Ask the local server whether the hand-off is enabled and which slicers it
 * found. Anything but an affirmative answer (disabled, static host, dev
 * server without the flag) keeps the button hidden — absence is the opt-out.
 */
async function setupOpenInSlicer() {
  try {
    const res = await fetch('/api/slicer/status')
    if (!res.ok) return
    const data = (await res.json()) as { enabled?: boolean; slicers?: SlicerInfo[] }
    if (!data.enabled || !data.slicers?.length) return
    slicerChoices = data.slicers
    slicerSelect.replaceChildren()
    for (const s of slicerChoices) {
      const opt = document.createElement('option')
      opt.value = s.id
      opt.textContent = s.name
      slicerSelect.appendChild(opt)
    }
    const saved = localStorage.getItem('hf-slicer-id')
    if (saved && slicerChoices.some((s) => s.id === saved)) slicerSelect.value = saved
    openSlicerRow.hidden = false
  } catch {
    /* no local API — the row stays hidden */
  }
}

slicerSelect.addEventListener('change', () => {
  localStorage.setItem('hf-slicer-id', slicerSelect.value)
})

btnOpenSlicer.addEventListener('click', async () => {
  if (!current) return
  btnOpenSlicer.disabled = true
  try {
    const base = exportFilename(current, '3mf').slice(0, -4)
    const bytes = export3mfFile(current, base)
    const query = new URLSearchParams({ slicer: slicerSelect.value, filename: `${base}.3mf` })
    const res = await fetch(`/api/slicer/open?${query}`, {
      method: 'POST',
      headers: { 'X-HueForge': '1', 'Content-Type': 'application/octet-stream' },
      body: bytes as unknown as BodyInit,
    })
    const data = (await res.json().catch(() => ({}))) as { slicer?: string; error?: string }
    if (!res.ok) throw new Error(data.error ?? String(res.status))
    showStatus(tr('openSlicerDone', { slicer: data.slicer ?? slicerSelect.selectedOptions[0]?.textContent ?? 'slicer' }))
  } catch (err) {
    showStatus(tr('openSlicerError', { detail: err instanceof Error ? err.message : String(err) }), true)
  } finally {
    btnOpenSlicer.disabled = !current
  }
})

versionBadge.textContent = `v${__APP_VERSION__}`

restoreSettings()
fillPrinterSelect()
void setupOpenInSlicer()

// Palette panel collapse: restore the saved state and bind the chevron.
{
  const collapseBtn = document.getElementById('palette-collapse')
  let saved = false
  try { saved = localStorage.getItem(PALETTE_COLLAPSED_KEY) === '1' } catch { /* private mode */ }
  if (saved) setPaletteCollapsed(true, false)
  collapseBtn?.addEventListener('click', () => {
    const body = document.getElementById('palette-body')
    setPaletteCollapsed(!(body?.classList.contains('is-collapsed') ?? false))
  })
}

// Language: apply immediately (before first paint), bind the switcher.
langSelect.value = lang
langSelect.addEventListener('change', () => setLang(langSelect.value as Lang))
applyStaticText()
setupLangPrompt()
setupWelcome()

setupTheme()
setupDropZone()
bindInputs()
setupExports()
setupReference()
renderTicks()
