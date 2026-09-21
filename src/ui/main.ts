import './styles.css'
import { exportStl, export3mfFile, exportFilename, type PipelineResult } from '../lib/pipeline'
import { loadImageForPrint } from '../lib/loadImage'
import { fitToneInWorker, quantizeInWorker, rebuildInWorker, setResultListener } from './workerClient'
import { matchTonePreset, presetPercents, tonePreset, type TonePresetId } from '../lib/tonePresets'
import type { WorkerResult } from '../lib/workerProtocol'
import { MATERIALS, LIBRARY, BRANDS, materialName, nearestLibraryFilament, findFilament, addCustomFilament, removeCustomFilament, restoreCustomFilament, customFilaments, isCustomId, CUSTOM_BRAND_ID, type LibraryChoice, type MaterialId, type CustomFilament } from '../lib/filamentLibrary'
import { buildProjectFile, parseProjectFile, ProjectFileError, PROJECT_EXTENSION, type ProjectFile, type ProjectSettings, type ProjectPaletteSlot } from '../lib/project'
import { describeExport } from '../lib/describe'
import { buildSlicerBundle } from '../lib/slicerBundle'
import { buildCalibrationSwatch, fitTau, CALIB_STEPS, type CalibSample } from '../lib/calibration'
import { DEFAULT_TAU_MM, backlitBandColors, tauBandHeights, transmittedBandColors } from '../lib/transmission'
import type { ColorCount, QuantizedImage, SourcePreview } from '../lib/types'
import type { SlicerInfo } from '../../slicer-launch.mjs'
import { layerView } from '../lib/layerView'
import { fitPrintSizeToAspect } from '../lib/printConsts'
import { deltaE2000Rgb } from '../lib/deltae'
import { analyzePrintability, fixFor, type PrintabilityFix } from '../lib/printability'
import { createPerfStats } from '../lib/perfStats'
import { rgbToHex, hexToRgb, nearestFilament, luminance } from '../lib/palette'
import { MAX_REFERENCE_FILE_BYTES, Reference3mfParseError } from '../lib/reference3mf'
import { analyzeStlInWorker, parseReference3mfInWorker } from './referenceWorkerClient'
import { planReferenceApply, type ReferenceApplyPlan } from '../lib/referenceApply'
import { compareRelief, measureRelief, profileDistance, StlParseError, type ReliefMetrics } from '../lib/reliefCompare'
import type { Reference3mfAnalysis } from '../lib/reference3mf'
import type { StlAnalysis } from '../lib/referenceWorkerProtocol'
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
import { isDesktop, desktopSaveFile, initDesktopShell, setDesktopLang } from './desktop'

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector(sel)
  if (!el) throw new Error(`Missing element: ${sel}`)
  return el as T
}

let current: PipelineResult | null = null
let currentFile: File | null = null
/** Full(er)-resolution decode of the current file, for the source preview. */
let lastSourcePreview: SourcePreview | null = null
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
const paletteTauHeights = $<HTMLButtonElement>('#palette-tau-heights')
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
const pbBadge = $<HTMLButtonElement>('#pb-badge')
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
const contrastSlider = $<HTMLInputElement>('#contrast-slider')
const contrastValue = $<HTMLSpanElement>('#contrast-value')
const powerSlider = $<HTMLInputElement>('#power-slider')
const powerValue = $<HTMLSpanElement>('#power-value')
const presetRow = $<HTMLDivElement>('#tone-presets')
const presetHint = $<HTMLParagraphElement>('#preset-hint')
const presetCustom = $<HTMLSpanElement>('#tone-custom')
const toneResult = $<HTMLParagraphElement>('#tone-result')
const reliefSplit = $<HTMLParagraphElement>('#relief-split')
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
const langBtn = $<HTMLButtonElement>('#lang-btn')
const langCode = $<HTMLSpanElement>('#lang-code')
const langMenu = $<HTMLDivElement>('#lang-menu')
const themeBtn = $<HTMLButtonElement>('#theme-btn')
const themeIco = $<HTMLElement>('#theme-ico')
const themeMenu = $<HTMLDivElement>('#theme-menu')
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
const refBadge = $<HTMLButtonElement>('#ref-badge')
const refPaletteSection = $<HTMLDivElement>('#ref-palette-section')
const refSwapsSection = $<HTMLDivElement>('#ref-swaps-section')
const refCompareSection = $<HTMLDivElement>('#ref-compare-section')
const refCompareSummary = $<HTMLParagraphElement>('#ref-compare-summary')
const refCompareBody = $<HTMLTableSectionElement>('#ref-compare-body')
const refCompareNote = $<HTMLParagraphElement>('#ref-compare-note')
const refFitBtn = $<HTMLButtonElement>('#ref-fit')
const refFitNote = $<HTMLParagraphElement>('#ref-fit-note')

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
  /** Relief contrast in percent (100 = unchanged). */
  contrast: number
  /** Relief detail deepening in percent (100 = unchanged). */
  power: number
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
      contrast: clampNum(Number(contrastSlider.value), 0, 300, 100),
      power: clampNum(Number(powerSlider.value), 20, 300, 100),
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
    contrastSlider.value = String(clampNum(Number(s.contrast), 0, 300, 100))
    powerSlider.value = String(clampNum(Number(s.power), 20, 300, 100))
    syncToneReadouts()
    syncReliefSplit()
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
  const contrast = clampNum(Number(contrastSlider.value), 0, 300, 100) / 100
  const power = clampNum(Number(powerSlider.value), 20, 300, 100) / 100
  const mergeDeltaE = mergeCheck.checked ? clampNum(Math.round(Number(mergeInput.value)), 1, 40, 10) : 0
  const baseMm = clampNum(Number(baseInput.value), 0, 5, 0.8)
  const maxHeightMm = clampNum(Number(maxInput.value), baseMm + 2, 40, 8)
  return {
    numColors: numColors as ColorCount,
    darkIsTall,
    dither,
    contrast,
    power,
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
    const { image, sourcePreview, sourceWidth, sourceHeight } = await loadImageForPrint(file, opts.widthMm, opts.heightMm, lang)
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
    lastSourcePreview = sourcePreview
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
  // Localized tooltips: [data-i18n-title] maps the attribute to el.title and
  // follows language switches (splitters, clamped preview title, collapse btn).
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const key = el.dataset.i18nTitle
    if (key) el.title = tr(key)
  }
  // Empty-state hints inside the preview wraps: [data-empty-i18n] holds the
  // i18n key rendered by the .pair-canvas.is-empty::before CSS rule.
  for (const el of document.querySelectorAll<HTMLElement>('[data-empty-i18n]')) {
    const key = el.dataset.emptyI18n
    if (key) el.dataset.empty = tr(key)
  }
  // Icon-only buttons: [data-i18n-aria] maps a key to aria-label (title comes
  // from data-i18n-title) so the tooltip and the accessible name follow
  // language switches.
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    const key = el.dataset.i18nAria
    if (key) el.ariaLabel = tr(key)
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
  contrastSlider.ariaLabel = tr('toneContrast')
  powerSlider.ariaLabel = tr('tonePower')
  document.querySelector('.sidebar-tabs')?.setAttribute('aria-label', tr('sidebarTabsAria'))
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
  langCode.textContent = lang.toUpperCase()
  applyStaticText()
  syncReliefSplit()
  syncToneReadouts()
  renderToneResult()
  setDesktopLang(lang)
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

// ---- sidebar tabs ---------------------------------------------------------

const SIDEBAR_TAB_KEY = 'hf-sidebar-tab'
type SidebarTabId = 'model' | 'check' | 'export'
const SIDEBAR_TABS: readonly SidebarTabId[] = ['model', 'check', 'export']
let activeSidebarTab: SidebarTabId = 'model'

/** Show one tab panel and mark its tab active; unknown ids are ignored. */
function setSidebarTab(tab: SidebarTabId, persist = true) {
  if (!SIDEBAR_TABS.includes(tab)) return
  activeSidebarTab = tab
  for (const t of SIDEBAR_TABS) {
    const btn = document.getElementById(`tab-${t}`)
    const panel = document.getElementById(`tabpanel-${t}`)
    if (!btn || !panel) continue
    const on = t === tab
    btn.classList.toggle('is-active', on)
    btn.setAttribute('aria-selected', String(on))
    btn.tabIndex = on ? 0 : -1
    panel.hidden = !on
  }
  if (persist) {
    try { localStorage.setItem(SIDEBAR_TAB_KEY, tab) } catch { /* private mode */ }
  }
}

/** Click + arrow-key navigation for the tab strip (WAI-ARIA tabs pattern). */
function setupSidebarTabs() {
  const strip = document.querySelector('.sidebar-tabs')
  if (!strip) return
  strip.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-tab-btn]')
    if (btn) setSidebarTab(btn.dataset.tabBtn as SidebarTabId)
  })
  strip.addEventListener('keydown', (e) => {
    const evt = e as KeyboardEvent
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 }
    const delta = keys[evt.key]
    if (!delta) return
    evt.preventDefault()
    const i = SIDEBAR_TABS.indexOf(activeSidebarTab)
    const next = SIDEBAR_TABS[(i + delta + SIDEBAR_TABS.length) % SIDEBAR_TABS.length]
    setSidebarTab(next)
    document.getElementById(`tab-${next}`)?.focus()
  })
  let saved: string | null = null
  try { saved = localStorage.getItem(SIDEBAR_TAB_KEY) } catch { /* private mode */ }
  setSidebarTab(SIDEBAR_TABS.includes(saved as SidebarTabId) ? (saved as SidebarTabId) : 'model', false)
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
    revealTarget: (target) => {
      // Steps point at sections inside tab panels — surface the owning tab
      // before the spotlight measures, so hidden controls can be shown.
      const panel = target.closest<HTMLElement>('[data-tab-panel]')
      if (panel?.dataset.tabPanel) setSidebarTab(panel.dataset.tabPanel as SidebarTabId, false)
    },
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
  // Empty state: hide the placeholder canvases (they render as dark
  // rectangles) and show a hint inside each preview wrap instead.
  const hasImage = Boolean(current)
  for (const wrap of document.querySelectorAll('.viewer-pair .canvas-wrap')) {
    wrap.classList.toggle('is-empty', !hasImage)
    const canvas = wrap.querySelector('canvas')
    if (canvas) canvas.hidden = !hasImage
  }
  if (!current) return
  syncMaxInput()
  drawSource()
  drawQuantized()
  renderPalette()
  renderToneResult()
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
  renderReliefComparison()
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

/** Head status button: worst finding at a glance, details in the tooltip. */
function setPbBadge(report: ReturnType<typeof analyzePrintability>) {
  const kind = report.errors > 0 ? 'error' : report.warnings > 0 ? 'partial' : 'complete'
  pbBadge.className = `status-ico-btn ${kind}`
  pbBadge.title = report.errors > 0
    ? `${word(lang, report.errors, 'errors')} · ${word(lang, report.warnings, 'warnings')}`
    : report.warnings > 0
      ? `${word(lang, report.warnings, 'warnings')} · ${tr('allPassed').replace(/^[^ ]+ /, '')}`
      : tr('allPassed')
  pbBadge.ariaLabel = pbBadge.title
  pbBadge.disabled = true // status glyph, not an action
  pbBadge.hidden = false
}

function drawSource() {
  // Prefer the full(er)-resolution decode: the print pipeline downsamples to
  // nozzle-fit resolution, which throws away detail the user can still see.
  if (lastSourcePreview) {
    const { width, height, rgba } = lastSourcePreview
    canvasSource.width = width
    canvasSource.height = height
    canvasSource.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
    return
  }
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
  // The ΔE field is a per-pixel CIEDE2000 pass over the whole image — by far
  // the most expensive step here, and only the ΔE 3D mode displays it. Compute
  // it on demand and cache it per state version, so ordinary slider drags stay
  // responsive while toggling the ΔE mode back and forth stays instant.
  if (viewer3dMode === 'deltae') drawDeltaE()
  else deltaeStats.hidden = true
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
  syncReliefSplit()
}

/** The two tone sliders as percent numbers (100 = the picture's own tones). */
function tonePercents(): { contrast: number; power: number } {
  return { contrast: Number(contrastSlider.value), power: Number(powerSlider.value) }
}

/**
 * Percentage badges of the two relief-tone sliders, plus which named style
 * they currently hold. A tone matching no style is not an error — the auto-fit
 * and hand-made settings land there — so it is shown as «Custom» with its own
 * numbers rather than leaving the row looking unset.
 */
function syncToneReadouts() {
  const { contrast, power } = tonePercents()
  contrastValue.textContent = `${contrast}%`
  powerValue.textContent = `${power}%`
  const active = matchTonePreset(contrast / 100, power / 100)
  for (const btn of presetRow.querySelectorAll<HTMLButtonElement>('.preset-btn')) {
    const on = btn.dataset.preset === active
    btn.classList.toggle('is-active', on)
    btn.ariaPressed = on ? 'true' : 'false'
  }
  presetCustom.hidden = active !== null
  const key = active ? `presetHint${active.charAt(0).toUpperCase()}${active.slice(1)}` : 'presetHintCustom'
  presetHint.textContent = tr(key, { contrast, power })
}

/** Bare millimetre number in the panel's own style: «3.60». */
const mm2 = (v: number) => v.toFixed(2)

/**
 * One line saying what the current setting produces: the base + relief split
 * and the heights where the filament changes. Read from the finished result, so
 * it describes the model actually on screen — the same numbers the palette rows
 * carry, gathered next to the styles that produced them.
 */
function renderToneResult() {
  if (!current) {
    toneResult.textContent = ''
    return
  }
  const base = current.settings.baseMm
  const total = current.settings.maxHeightMm
  const colors = word(lang, current.palette.length, 'colors')
  // The topmost band ends at the model top: that is where the print finishes,
  // not a moment where the filament changes.
  const swaps = current.palette
    .map((entry) => entry.topZMm)
    .filter((top) => top < total - 1e-9)
    .sort((a, b) => a - b)
  toneResult.textContent =
    swaps.length > 0
      ? tr('toneResult', {
          base: mm2(base),
          relief: mm2(total - base),
          total: mm2(total),
          colors,
          swaps: swaps.map(mm2).join(' / '),
        })
      : tr('toneResultSingle', { base: mm2(base), relief: mm2(total - base), total: mm2(total), colors })
}

/**
 * Spell out the relief model where the size fields are: a solid base slab plus
 * the relief thickness the picture modulates, which is the split the free
 * Filapaint tool exposes as «Base Thickness» and «Relief Thickness» (their sum
 * is the total height). Custom band heights move the total, so this follows
 * `syncMaxInput` as well.
 */
function syncReliefSplit() {
  const base = Number(baseInput.value)
  const total = Number(maxInput.value)
  if (!Number.isFinite(base) || !Number.isFinite(total) || !(total > base)) {
    reliefSplit.textContent = ''
    return
  }
  // Two decimals and no narrowing, exactly like the palette rows and the tone
  // result line: the same height must not print as 0.8 in one place and 0.80 in
  // another.
  const fmt = mm2
  reliefSplit.textContent = tr('reliefSplit', {
    base: fmt(base),
    relief: fmt(total - base),
    total: fmt(total),
  })
}

paletteHeightsReset.addEventListener('click', () => {
  bandHeights = null
  syncMaxInput()
  rebuildNow(true)
  saveSettings()
})

paletteTauHeights.addEventListener('click', () => {
  if (!current) return
  const n = current.quantized.palette.length
  const taus = current.quantized.tauMm
  const base = Number(baseInput.value) || 0.8
  const max = Number(maxInput.value) || 10
  bandHeights = tauBandHeights(
    Array.from({ length: n }, (_, i) => (taus?.[i] && taus[i] > 0 ? taus[i] : DEFAULT_TAU_MM)),
    { usableMm: Math.max(0, max - base) },
  )
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
    contrast: Math.round(opts.contrast * 100),
    power: Math.round(opts.power * 100),
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
  void triggerDownload(text, filename, 'text/plain;charset=utf-8').then((outcome) =>
    reportDownload(outcome, tr('shoppingListDone', { filename })),
  )
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

/** Badge on the Check tab: the number of colors currently in the palette. */
function updateCheckColorBadge(count: number) {
  const badge = document.getElementById('check-color-badge')
  if (!badge) return
  badge.textContent = String(count)
  badge.hidden = count <= 0
  badge.setAttribute('aria-label', `${tr('checkColorBadgeAria')}: ${count}`)
}

function renderPalette() {
  const palette = current!.palette
  updateCheckColorBadge(palette.length)
  paletteList.innerHTML = ''
  // Area share of each palette color (post-dither, post-cleanup — exactly
  // what will be printed); indexMap indexes quantized.palette 1:1 with rows.
  const shares = colorShares(current!.quantized.indexMap, palette.length)
  renderCoverage(shares, palette)
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
  deltaeStats.hidden = mode !== 'deltae'
  if (mode === 'deltae') {
    // Drop any layer cut FIRST: setSlice(null) resets the viewer to the plain
    // filament material, so applying the ΔE map before it would be undone and
    // the overlay would never appear.
    viewer3d.setSlice(null)
    applyDeltaETo3d()
    drawDeltaE()
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
  void (async () => {
    const stlOutcome = await triggerDownload(sw.stl as unknown as BlobPart, `${name}.stl`, 'model/stl')
    if (stlOutcome !== 'saved') {
      reportDownload(stlOutcome, tr('calibDownloadDone', { filename: `${name}.stl` }))
      return
    }
    const infoOutcome = await triggerDownload(sw.info, `${name}.txt`, 'text/plain;charset=utf-8')
    reportDownload(infoOutcome, tr('calibDownloadDone', { filename: `${name}.stl` }))
  })()
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

type DownloadOutcome = 'saved' | 'canceled' | 'error'

/** Save an export and report the actual result, rather than assuming success before the dialog closes. */
async function triggerDownload(data: BlobPart, filename: string, type: string): Promise<DownloadOutcome> {
  try {
    if (isDesktop) return await desktopSaveFile(data, filename, type)
    const url = URL.createObjectURL(new Blob([data], { type }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    return 'saved'
  } catch {
    return 'error'
  }
}

function reportDownload(outcome: DownloadOutcome, successMessage: string) {
  if (outcome === 'saved') showStatus(successMessage)
  else if (outcome === 'canceled') showStatus(tr('desktopSaveCanceled'), true)
  else showStatus(tr('desktopSaveError'), true)
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
/** Moon for dark themes, sun for light ones — the button reflects the pick. */
const THEME_ICON_SVG = {
  dark: '<path d="M13.4 9.4A5.8 5.8 0 1 1 6.6 2.6a4.7 4.7 0 0 0 6.8 6.8Z"/>',
  nord: '<path d="M13.4 9.4A5.8 5.8 0 1 1 6.6 2.6a4.7 4.7 0 0 0 6.8 6.8Z"/>',
  light: '<circle cx="8" cy="8" r="2.6"/><path d="M8 1.8v1.5M8 12.7v1.5M1.8 8h1.5M12.7 8h1.5M3.7 3.7l1 1M11.3 11.3l1 1M12.3 3.7l-1 1M4.7 11.3l-1 1"/>',
  solar: '<circle cx="8" cy="8" r="2.6"/><path d="M8 1.8v1.5M8 12.7v1.5M1.8 8h1.5M12.7 8h1.5M3.7 3.7l1 1M11.3 11.3l1 1M12.3 3.7l-1 1M4.7 11.3l-1 1"/>',
} as const

function applyTheme(theme: string, persist = true) {
  document.documentElement.dataset.theme = theme
  if (persist) {
    try { localStorage.setItem('hf-theme', theme) } catch { /* private mode */ }
  }
  themeIco.innerHTML = THEME_ICON_SVG[theme as keyof typeof THEME_ICON_SVG] ?? THEME_ICON_SVG.dark
  for (const item of themeMenu.querySelectorAll<HTMLButtonElement>('[data-theme]')) {
    item.classList.toggle('is-active', item.dataset.theme === theme)
  }
  viewer3d?.setBackground(THEME_VIEWER_BG[theme] ?? THEME_VIEWER_BG.dark)
}

/** Open/close one topbar popover menu; the rest close automatically. */
function toggleMenu(menu: HTMLElement, btn: HTMLElement, force?: boolean) {
  const show = force ?? menu.hidden
  for (const m of [langMenu, themeMenu]) {
    m.hidden = m !== menu || !show
  }
  langBtn.setAttribute('aria-expanded', String(langMenu === menu && show))
  themeBtn.setAttribute('aria-expanded', String(themeMenu === menu && show))
  if (show) btn.classList.add('is-open')
  else btn.classList.remove('is-open')
}

function closeMenu(menu: HTMLElement, btn: HTMLElement) {
  toggleMenu(menu, btn, false)
}

function setupTheme() {
  const saved = (() => { try { return localStorage.getItem('hf-theme') } catch { return null } })()
  const initial = saved && THEME_VIEWER_BG[saved] ? saved : 'dark'
  applyTheme(initial)
  themeBtn.addEventListener('click', () => toggleMenu(themeMenu, themeBtn))
  themeMenu.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-theme]')
    if (!item) return
    applyTheme(item.dataset.theme ?? 'dark')
    closeMenu(themeMenu, themeBtn)
  })
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
      syncReliefSplit()
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

  // Relief tone (contrast, detail deepening): like dithering these live in the
  // quantize step — the color bands are read off the toned values — so a drag
  // reprocesses live and the release flushes the run.
  for (const slider of [contrastSlider, powerSlider]) {
    slider.addEventListener('input', () => {
      syncToneReadouts()
      scheduleReprocess()
    })
    slider.addEventListener('change', () => {
      flushReprocess()
      saveSettings()
    })
  }

  // Named relief styles: a style is just both sliders at once, so it takes the
  // same path as a drag and the panel keeps a single source of truth.
  for (const btn of presetRow.querySelectorAll<HTMLButtonElement>('.preset-btn')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.preset as TonePresetId | undefined
      if (!id) return
      const { contrast, power } = presetPercents(tonePreset(id))
      contrastSlider.value = String(contrast)
      powerSlider.value = String(power)
      syncToneReadouts()
      saveSettings()
      flushReprocess()
    })
  }

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
/** A dropped reference STL: a .3mf carries settings, an .stl carries relief only. */
let referenceStl: StlAnalysis | null = null
/** Guards against overlapping analyses: a newer selection supersedes an older one. */
let refRun = 0
/** Our own relief metrics, cached per pipeline result — the scan is not free. */
let ownMetricsCache: { result: PipelineResult; metrics: ReliefMetrics } | null = null

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

function showRefError(code: string, fallback: string, prefix = 'refErr') {
  // Error codes are kebab-case ('missing-model', 'entry-size'); the i18n
  // keys are camelCase ('refErrMissingModel', 'refErrEntrySize').
  const key = `${prefix}${code.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')}`
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
  refBadge.className = `status-ico-btn ${kind}`
  refBadge.dataset.kind = kind
  refBadge.title = tr(keyMap[kind])
  refBadge.ariaLabel = refBadge.title
  refBadge.disabled = true // status glyph, not an action
}

function resetReferenceUI() {
  refReport.hidden = true
  refError.hidden = true
  refApplyBtn.disabled = true
  refApplyNote.textContent = ''
  refCompareSection.hidden = true
  // A new reference invalidates the previous fit's verdict.
  refFitBtn.disabled = true
  setFitNote('')
}

/**
 * Measure our own relief with the same instrument used on the reference, so
 * the two columns are comparable. The grid pitch cannot be recovered from a
 * merged mesh (faces only end where a run ends), so the design pitch is
 * supplied from the print settings.
 */
function ownReliefMetrics(result: PipelineResult): ReliefMetrics {
  if (ownMetricsCache && ownMetricsCache.result === result) return ownMetricsCache.metrics
  const metrics = measureRelief(result.mesh.positions, result.mesh.triangleCount, {
    gridStepX: result.field.width > 0 ? result.settings.widthMm / result.field.width : 0,
    gridStepY: result.field.height > 0 ? result.settings.heightMm / result.field.height : 0,
  })
  ownMetricsCache = { result, metrics }
  return metrics
}

/**
 * Our relief measured against the reference STL, row by row. Rows the two
 * disagree on are flagged, so the panel reads as a checklist rather than a
 * wall of numbers.
 */
function renderReliefComparison() {
  if (!referenceStl) {
    refCompareSection.hidden = true
    return
  }
  refCompareSection.hidden = false
  refCompareBody.innerHTML = ''
  refCompareSummary.textContent = ''
  refCompareNote.textContent = ''
  updateFitButton()
  if (!current) {
    refCompareNote.textContent = tr('refCompareNeedsImage')
    return
  }

  const comparison = compareRelief(referenceStl.metrics, ownReliefMetrics(current))
  for (const row of comparison.rows) {
    const trEl = document.createElement('tr')
    trEl.className = `rc-${row.status}`
    const th = document.createElement('th')
    th.scope = 'row'
    th.textContent = tr(row.key)
    const refCell = document.createElement('td')
    refCell.textContent = row.refText
    const ownCell = document.createElement('td')
    ownCell.textContent = row.ownText
    const deltaCell = document.createElement('td')
    deltaCell.textContent = row.deltaText
    trEl.append(th, refCell, ownCell, deltaCell)
    refCompareBody.appendChild(trEl)
  }
  refCompareSummary.textContent = comparison.diverging === 0
    ? tr('refCompareAllMatch')
    : tr('refCompareDiverge', { n: comparison.diverging, total: comparison.rows.length })
  refCompareNote.textContent = tr('refCompareNote')
}

/** True while the tone fit is searching; the button stays disabled then. */
let toneFitRunning = false

/**
 * Note under the fit button. `keep` holds a verdict on screen, tagged with the
 * tone it belongs to: the moment the sliders move away from that tone the note
 * is no longer about what is on screen, so it falls back to the hint.
 */
function setFitNote(text: string, keep = false) {
  refFitNote.textContent = text
  if (keep) {
    refFitNote.dataset.keep = '1'
    refFitNote.dataset.tone = `${contrastSlider.value}/${powerSlider.value}`
  } else {
    delete refFitNote.dataset.keep
    delete refFitNote.dataset.tone
  }
}

/** True when the note on screen still describes the tone in the sliders. */
function fitNoteHolds(): boolean {
  return refFitNote.dataset.keep === '1' && refFitNote.dataset.tone === `${contrastSlider.value}/${powerSlider.value}`
}

/**
 * The tone fit needs both halves of the comparison — a reference to measure
 * and our own relief to change — and it cannot act when the heights come from
 * the palette instead of the picture's tones (spool mode), because there the
 * tone knobs move nothing.
 */
function updateFitButton() {
  if (toneFitRunning) {
    refFitBtn.disabled = true
    return
  }
  if (!referenceStl) {
    refFitBtn.disabled = true
    return
  }
  // A verdict stays on screen until the tone, the reference or the mode
  // changes: it is the answer to the fit the user just ran.
  const holds = fitNoteHolds()
  if (!current) {
    refFitBtn.disabled = true
    if (!holds) setFitNote(tr('refFitNeedsImage'))
    return
  }
  if (catalogActive) {
    refFitBtn.disabled = true
    setFitNote(tr('refFitManualMode'))
    return
  }
  refFitBtn.disabled = false
  if (!holds) setFitNote(tr('refFitHint'))
}

/** Percent string of a 0…1 profile mismatch, the number shown to the user. */
const fitPercent = (v: number) => (v * 100).toFixed(1)

/**
 * Fit contrast and Detail to the loaded reference: the search runs in the
 * worker (a few dozen pipeline passes, each measured with the same instrument
 * that measured the reference) and the winner is written into the two sliders
 * and applied by a normal reprocess. Nothing else about the print changes —
 * the palette, the filaments and the band heights are untouched.
 */
async function runToneFit(): Promise<void> {
  if (!referenceStl || !current || !currentFile || toneFitRunning) return
  const image = current.image
  const target = referenceStl.metrics
  // The tone in use: the number the fit has to beat, and the setting it keeps
  // when nothing beats it.
  const currentTone = {
    contrast: Number(contrastSlider.value) / 100,
    power: Number(powerSlider.value) / 100,
  }
  const before = profileDistance(target.heightProfile, ownReliefMetrics(current).heightProfile)
  toneFitRunning = true
  refFitBtn.disabled = true
  setFitNote(tr('refFitWorking'))
  try {
    const fit = await fitToneInWorker(
      image.rgba,
      image.width,
      image.height,
      readOptions(),
      target,
      (done, total) => {
        setFitNote(tr('refFitRunning', { done, total }))
      },
      currentTone,
    )
    if (!fit.improved) {
      setFitNote(tr('refFitNeutral', { from: fitPercent(before) }), true)
      return
    }
    const contrast = Math.round(fit.best.contrast * 100)
    const power = Math.round(fit.best.power * 100)
    contrastSlider.value = String(contrast)
    powerSlider.value = String(power)
    syncToneReadouts()
    saveSettings()
    // The range inputs snap to their own step, so the applied values are read
    // back from them — the message must name what the pipeline actually used.
    const appliedContrast = Number(contrastSlider.value)
    const appliedPower = Number(powerSlider.value)
    // Reprocess with the fitted tone so the mesh, the comparison and any
    // export all show the setting the fit chose.
    const readOk = await readFile(currentFile)
    if (!readOk || !current) {
      // The sliders hold the fitted tone but the relief on screen is not that
      // tone's: say so instead of quoting a number that belongs to another
      // mesh (the app shows the reason in the status line).
      setFitNote(tr('refFitRebuildFailed', { contrast: appliedContrast, power: appliedPower }), true)
      return
    }
    // The mismatch is reported from the reprocessed mesh — the same number the
    // comparison table shows — instead of the search's own prediction.
    const after = profileDistance(target.heightProfile, ownReliefMetrics(current).heightProfile)
    setFitNote(
      tr('refFitDone', {
        contrast: appliedContrast,
        power: appliedPower,
        from: fitPercent(before),
        to: fitPercent(after),
      }),
      true,
    )
  } catch (err) {
    setFitNote(err instanceof Error ? err.message : tr('refError'))
  } finally {
    toneFitRunning = false
    updateFitButton()
  }
}

/** Report for a dropped reference STL: footprint, relief shape, comparison. */
function renderStlReport() {
  const a = referenceStl
  if (!a) return
  refEmpty.hidden = true
  refReport.hidden = false
  refError.hidden = true

  // A reference STL has no settings to apply: only the relief is readable.
  refPaletteSection.hidden = true
  refSwapsSection.hidden = true
  refMissingSection.hidden = true
  refApplyBtn.disabled = true
  refApplyNote.textContent = tr('refStlNoApply')

  const status = a.truncated ? 'partial' : 'complete'
  refStatus.textContent = a.truncated ? tr('refPartial') : tr('refComplete')
  refStatus.className = `ref-status ${status}`
  setRefBadge(status)
  refModelLine.textContent = tr('refStlModelLine', {
    w: parseFloat(a.metrics.sizeX.toFixed(2)),
    h: parseFloat(a.metrics.sizeY.toFixed(2)),
    z: parseFloat(a.metrics.sizeZ.toFixed(2)),
    tris: word(lang, a.metrics.triangleCount, 'tris'),
    grid: parseFloat(a.metrics.gridStepX.toFixed(3)),
  })

  refWarningsSection.hidden = !a.truncated
  if (a.truncated) {
    refWarningsEl.innerHTML = ''
    const item = document.createElement('div')
    item.textContent = tr('refStlTruncated')
    refWarningsEl.appendChild(item)
  }

  renderReliefComparison()
}

/** Show an STL parse failure using the `stlErr*` keys for the typed codes. */
function showStlError(err: unknown) {
  refReport.hidden = true
  refCompareSection.hidden = true
  setRefBadge('error')
  if (err instanceof StlParseError) showRefError(err.code, err.message, 'stlErr')
  else {
    refError.textContent = tr('refError')
    refError.hidden = false
  }
}

function renderReferenceReport() {
  if (!referenceAnalysis) return
  const a = referenceAnalysis
  refEmpty.hidden = true
  refReport.hidden = false
  refError.hidden = true
  // A 3MF carries the palette and swap schedule the STL path has to hide.
  refPaletteSection.hidden = false
  refSwapsSection.hidden = false

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

  renderReliefComparison()
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
  const token = ++refRun
  referenceAnalysis = null
  referencePlan = null
  referenceStl = null
  resetReferenceUI()
  refStatus.className = 'ref-status'
  refStatus.textContent = tr('refAnalyzing')
  refReport.hidden = false
  setRefBadge('analyzing')
  const isStl = /\.stl$/i.test(file.name)
  try {
    if (isStl) {
      // Check the size before reading the file: a reference STL runs to tens of
      // megabytes, and there is no point pulling it in just to reject it.
      if (file.size > MAX_REFERENCE_FILE_BYTES) throw new StlParseError('size', 'The reference file is larger than the 100 MB limit.')
      const analysis = await analyzeStlInWorker({ fileName: file.name, data: new Uint8Array(await file.arrayBuffer()) })
      if (token !== refRun) return // a newer selection superseded this one
      referenceStl = analysis
      renderStlReport()
    } else {
      const analysis = await parseReference3mfInWorker(file)
      if (token !== refRun) return // a newer selection superseded this one
      referenceAnalysis = analysis
      referencePlan = planReferenceApply(referenceAnalysis, currentEditorOptions())
      renderReferenceReport()
    }
  } catch (err) {
    if (token !== refRun) return
    if (isStl) {
      referenceStl = null
      showStlError(err)
    } else {
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
  // The reference supplies the band schedule as normalized band tops, so any
  // custom per-band thicknesses active in the editor no longer apply — clear
  // them or the next rebuild would silently revert to the stale heights.
  bandHeights = null
  // Palette colors were replaced wholesale; per-slot filament picks from the
  // previous palette are wrong for the reference colors, so fall back to the
  // nearest-suggestion labels for the new palette.
  filamentAssignments = []
  syncMaxInput()
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
    refInput.value = '' // allow re-selecting the same file to re-analyze
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
  refFitBtn.addEventListener('click', () => void runToneFit())
}

function setupExports() {
  btnStl.addEventListener('click', () => {
    if (!current) return
    const filename = exportFilename(current, 'stl')
    void triggerDownload(exportStl(current) as unknown as BlobPart, filename, 'model/stl').then((outcome) =>
      reportDownload(outcome, tr('exportStlDone', { filename })),
    )
  })
  btn3mf.addEventListener('click', () => {
    if (!current) return
    const filename = exportFilename(current, '3mf')
    void triggerDownload(export3mfFile(current, filename.slice(0, -4)) as unknown as BlobPart, filename, 'model/3mf').then((outcome) =>
      reportDownload(outcome, tr('export3mfDone', { filename })),
    )
  })
  btnDescribe.addEventListener('click', () => {
    if (!current) return
    const filename = exportFilename(current, 'txt')
    void triggerDownload(describeExport(current, filename), filename, 'text/plain;charset=utf-8').then((outcome) =>
      reportDownload(outcome, tr('describeDone', { filename })),
    )
  })
  btnSlicer.addEventListener('click', () => {
    if (!current) return
    const filename = exportFilename(current, 'zip').replace(/\.zip$/, '-prusaslicer.zip')
    void triggerDownload(buildSlicerBundle(current, filename.replace(/-prusaslicer\.zip$/, '.3mf')) as unknown as BlobPart, filename, 'application/zip').then((outcome) =>
      reportDownload(outcome, tr('slicerDone', { filename })),
    )
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
        contrast: Math.round(opts.contrast * 100),
        power: Math.round(opts.power * 100),
        darkIsTall,
        backlight: lightBackBtn.classList.contains('is-active'),
        ...(bandHeights ? { bandHeightsMm: [...bandHeights] } : {}),
      },
      palette,
    })
    const filename = `${exportFilename(current!, '3mf').slice(0, -4)}${PROJECT_EXTENSION}`
    void triggerDownload(JSON.stringify(project, null, 2), filename, 'application/json').then((outcome) =>
      reportDownload(outcome, tr('projectSaved', { name: filename })),
    )
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
  contrastSlider.value = String(clamp(s.contrast ?? 100, 0, 300, 100))
  powerSlider.value = String(clamp(s.power ?? 100, 20, 300, 100))
  syncToneReadouts()
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

// Language: apply immediately (before first paint), bind the switcher.
langCode.textContent = lang.toUpperCase()
langBtn.addEventListener('click', () => toggleMenu(langMenu, langBtn))
langMenu.addEventListener('click', (e) => {
  const item = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-lang]')
  if (!item) return
  setLang(item.dataset.lang as Lang)
  closeMenu(langMenu, langBtn)
})
applyStaticText()
updateUI() // paint the empty-state previews (hint instead of dark canvas)
setupLangPrompt()
/**
 * Drag handle between the sidebar and the preview column: resizing the sidebar
 * reflows the viewers. Width persists in localStorage; double-click resets.
 */
function setupSidebarSplit() {
  const handle = document.querySelector<HTMLElement>('.sidebar-split')
  const layout = document.querySelector<HTMLElement>('.layout')
  const sidebar = document.querySelector<HTMLElement>('.sidebar')
  if (!handle || !layout || !sidebar) return

  const SIDEBAR_W_KEY = 'hf-sidebar-w' // px width of the sidebar column
  const MIN_W = 240
  const MAX_W = 640

  const applySidebarWidth = (px: number) => {
    const w = Math.min(MAX_W, Math.max(MIN_W, Math.round(px)))
    layout.style.setProperty('--sidebar-w', `${w}px`)
    // Keep the CSS variable in sync with the topbar height for the shell math.
    const topbar = document.querySelector<HTMLElement>('.topbar')
    if (topbar) {
      layout.style.setProperty('--topbar-h', `${Math.round(topbar.getBoundingClientRect().height)}px`)
    }
    return w
  }

  // Restore saved width, then keep the shell height honest on reflow
  // (the topbar wraps on narrow windows and changes height).
  let currentW = 320
  const setW = (px: number, persist = false) => {
    currentW = applySidebarWidth(px)
    if (persist) {
      try { localStorage.setItem(SIDEBAR_W_KEY, String(currentW)) } catch { /* private mode */ }
    }
  }
  setW(Number(localStorage.getItem(SIDEBAR_W_KEY)) || 320)
  window.addEventListener('resize', () => { applySidebarWidth(currentW) })

  let startX = 0, startW = 0
  const begin = (e: PointerEvent) => {
    e.preventDefault()
    try { handle.setPointerCapture(e.pointerId) } catch { /* synthetic pointers */ }
    handle.classList.add('dragging')
    startX = e.clientX
    startW = currentW
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  handle.addEventListener('pointerdown', begin)
  handle.addEventListener('pointermove', (e) => {
    if (!handle.classList.contains('dragging')) return
    setW(startW + (e.clientX - startX), true)
  })
  const end = (e: PointerEvent) => {
    if (!handle.classList.contains('dragging')) return
    handle.classList.remove('dragging')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    try { handle.releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)

  // Keyboard: arrows nudge by 16px, Home/End jump to the limits.
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 48 : 16
    if (e.key === 'ArrowLeft') { setW(currentW - step, true); e.preventDefault() }
    else if (e.key === 'ArrowRight') { setW(currentW + step, true); e.preventDefault() }
    else if (e.key === 'Home') { setW(MIN_W, true); e.preventDefault() }
    else if (e.key === 'End') { setW(MAX_W, true); e.preventDefault() }
  })
  handle.addEventListener('dblclick', () => {
    try { localStorage.removeItem(SIDEBAR_W_KEY) } catch { /* private mode */ }
    setW(320)
  })
}

/**
 * Splitters between the two previews (horizontal drag) and between the pair
 * and the 3D viewer (vertical drag). Positions persist in localStorage.
 * The pair is a flex row whose left/right grow ratio is set via flex-basis
 * percentages; the vertical splitter sets the pair's height share.
 */
function setupViewerSplitters() {
  const pair = document.querySelector<HTMLElement>('.viewer-pair')
  const left = document.getElementById('viewer-source')
  const right = document.getElementById('viewer-quantized')
  const vsplit = document.querySelector<HTMLElement>('.pair-vsplit')
  const block3d = document.querySelector<HTMLElement>('.viewer3d-block')
  if (!pair || !left || !right || !vsplit || !block3d) return

  const PAIR_SPLIT_KEY = 'hf-pair-split' // percent of the pair width for the left card
  const V_SPLIT_KEY = 'hf-v-split' // percent of viewers height for the pair

  const applyPairSplit = (pct: number) => {
    // 30% floor: a narrower right card squeezes the print-preview canvas into
    // an unreadable sliver (object-fit scales it to the card's width).
    const p = Math.min(70, Math.max(30, pct))
    // Grow ratios, not basis percents: basis would divide the pair width
    // including the 9px splitter, making the two cards unequal.
    left.style.flex = `${p} 1 0`
    right.style.flex = `${100 - p} 1 0`
  }
  const applyVSplit = (pct: number) => {
    const p = Math.min(80, Math.max(20, pct))
    // Grow ratios: see applyPairSplit — basis percents include the splitters.
    pair.style.flex = `${p} 1 0`
    block3d.style.flex = `${100 - p} 1 0`
    block3d.style.minHeight = '260px'
  }

  // Restore saved proportions (defaults: 50/50 width, 55% pair height).
  try {
    const ps = Number(localStorage.getItem(PAIR_SPLIT_KEY))
    if (Number.isFinite(ps) && ps > 0) applyPairSplit(ps)
    const vs = Number(localStorage.getItem(V_SPLIT_KEY))
    if (Number.isFinite(vs) && vs > 0) applyVSplit(vs)
  } catch { /* private mode */ }

  const drag = (el: HTMLElement, onMove: (dx: number, dy: number, rect: DOMRect) => void) => {
    let startX = 0, startY = 0, startRect: DOMRect | null = null
    const begin = (e: PointerEvent) => {
      e.preventDefault()
      // Synthetic pointers (tests) have no active pointer: capture throws and
      // must not block the drag state.
      try { el.setPointerCapture(e.pointerId) } catch { /* no such active pointer */ }
      el.classList.add('dragging')
      startX = e.clientX
      startY = e.clientY
      startRect = el.getBoundingClientRect()
      document.body.style.cursor = getComputedStyle(el).cursor
      document.body.style.userSelect = 'none'
    }
    const move = (e: PointerEvent) => {
      if (!el.classList.contains('dragging') || !startRect) return
      onMove(e.clientX - startX, e.clientY - startY, startRect)
    }
    const end = (e: PointerEvent) => {
      if (!el.classList.contains('dragging')) return
      el.classList.remove('dragging')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try { el.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    }
    el.addEventListener('pointerdown', begin)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  // Horizontal splitter: move right edge = pair-relative percent.
  drag(document.querySelector<HTMLElement>('.pair-split')!, (dx, _dy, rect) => {
    const pairRect = pair.getBoundingClientRect()
    const pct = ((rect.left - pairRect.left + rect.width / 2 + dx) / pairRect.width) * 100
    applyPairSplit(pct)
    try { localStorage.setItem(PAIR_SPLIT_KEY, String(Math.min(70, Math.max(30, pct)))) } catch { /* private mode */ }
  })

  // Vertical splitter: dragging down shrinks the pair, grows the 3D block.
  drag(vsplit, (_dx, dy, rect) => {
    const viewersRect = pair.parentElement!.getBoundingClientRect()
    const splittersPx = 9 + 12 // both splitter strips incl. margins, roughly constant
    const pct = ((rect.top - viewersRect.top - splittersPx / 2 + dy + rect.height / 2) / viewersRect.height) * 100
    applyVSplit(pct)
    try { localStorage.setItem(V_SPLIT_KEY, String(Math.min(80, Math.max(20, pct)))) } catch { /* private mode */ }
  })

  // Double-click resets the respective proportion to an even split.
  const resetTo = (apply: (pct: number) => void, key: string) => {
    apply(50)
    try { localStorage.removeItem(key) } catch { /* private mode */ }
  }
  for (const [el, key, apply] of [
    [document.querySelector<HTMLElement>('.pair-split')!, PAIR_SPLIT_KEY, applyPairSplit],
    [vsplit, V_SPLIT_KEY, applyVSplit],
  ] as const) {
    el.addEventListener('dblclick', () => resetTo(apply, key))
  }

  // ---- bottom grip: extend the whole workspace below the viewport edge ----
  // Dragging down grows the app shell past 100vh (the page scrolls); the 3D
  // block's flex share follows via the existing v-split, so both preview rows
  // and the viewer get taller together. Double-click resets to fit-the-screen.
  const bottomGrip = document.querySelector<HTMLElement>('.viewers-bottom-split')
  const layoutEl = document.querySelector<HTMLElement>('.layout')
  const BOTTOM_KEY = 'hf-bottom-extra' // extra px past the viewport bottom
  const applyBottomExtra = (px: number) => {
    const v = Math.min(1200, Math.max(0, Math.round(px)))
    layoutEl?.style.setProperty('--viewers-extra', `${v}px`)
    layoutEl?.classList.toggle('extended', v > 0)
  }
  if (bottomGrip && layoutEl) {
    try {
      if (localStorage.getItem('hf-bottom-hint-seen')) bottomGrip.dataset.dragged = '1'
      const saved = Number(localStorage.getItem(BOTTOM_KEY))
      if (Number.isFinite(saved) && saved > 0) applyBottomExtra(saved)
    } catch { /* private mode */ }
    // dy is an offset from drag start, so the baseline must be captured once
    // per drag — reading the live value per move would compound it (down
    // grows quadratically, up clamps to 0 instantly).
    let dragStartExtra = 0
    bottomGrip.addEventListener('pointerdown', () => {
      // The CSS value carries a "px" suffix — parseFloat it (Number() would
      // return NaN and silently reset the baseline to 0 every drag).
      dragStartExtra = parseFloat(layoutEl.style.getPropertyValue('--viewers-extra')) || 0
    })
    drag(bottomGrip, (_dx, dy, _rect) => {
      const v = Math.min(1200, Math.max(0, dragStartExtra + dy))
      applyBottomExtra(v)
      // Once the user has actually resized, dim the invitation chevron so it
      // stops begging for attention.
      if (!bottomGrip.dataset.dragged) {
        bottomGrip.dataset.dragged = '1'
        try { localStorage.setItem('hf-bottom-hint-seen', '1') } catch { /* private mode */ }
      }
      try { localStorage.setItem(BOTTOM_KEY, String(v)) } catch { /* private mode */ }
    })
    bottomGrip.addEventListener('dblclick', () => {
      applyBottomExtra(0)
      try { localStorage.removeItem(BOTTOM_KEY) } catch { /* private mode */ }
    })
  }

  // ---- layout schemes: stacked (default) / two side by side / all in a row --
  const viewers = document.querySelector<HTMLElement>('.viewers')
  const layoutStrip = document.querySelector<HTMLElement>('.viewers-layout')
  const LAYOUT_KEY = 'hf-viewers-layout'
  const LAYOUTS = ['stack', 'row'] as const
  type ViewersLayout = (typeof LAYOUTS)[number]

  const applyLayout = (layout: ViewersLayout) => {
    if (!viewers) return
    viewers.dataset.layout = layout
    // Restore the vertical (stack) split pair-vs-3D.
    try {
      const vs = Number(localStorage.getItem(V_SPLIT_KEY))
      if (Number.isFinite(vs) && vs > 0) applyVSplit(vs)
      else {
        pair.style.flex = '55 1 0'
        block3d.style.flex = '45 1 0'
      }
    } catch { /* keep current */ }
    // Radiogroup state
    for (const btn of layoutStrip?.querySelectorAll<HTMLButtonElement>('.layout-btn') ?? []) {
      const on = btn.dataset.layout === layout
      btn.classList.toggle('is-active', on)
      btn.setAttribute('aria-checked', String(on))
    }
  }

  layoutStrip?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-layout]')
    if (!btn) return
    const layout = btn.dataset.layout as ViewersLayout
    if (!LAYOUTS.includes(layout)) return
    applyLayout(layout)
    try { localStorage.setItem(LAYOUT_KEY, layout) } catch { /* private mode */ }
    // Re-render 3D canvas at the new size (renderer resizes on its own RAF;
    // a nudge avoids a stale-size frame right after switching).
    window.dispatchEvent(new Event('resize'))
  })

  let savedLayout: string | null = null
  try { savedLayout = localStorage.getItem(LAYOUT_KEY) } catch { /* private mode */ }
  applyLayout(LAYOUTS.includes(savedLayout as ViewersLayout) ? (savedLayout as ViewersLayout) : 'stack')
}

setupWelcome()
setupSidebarTabs()
setupViewerSplitters()
setupSidebarSplit()

setupTheme()
document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('.topbar-menu')) {
    closeMenu(langMenu, langBtn)
    closeMenu(themeMenu, themeBtn)
  }
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenu(langMenu, langBtn)
    closeMenu(themeMenu, themeBtn)
  }
})
setupDropZone()
bindInputs()
setupExports()
setupReference()
renderTicks()
initDesktopShell(lang)
