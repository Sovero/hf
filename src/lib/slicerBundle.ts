import { zipSync, strToU8 } from 'fflate'
import type { PipelineResult } from './pipeline'
import { nearestFilament, rgbToHex } from './palette'

const SCRIPT_NAME = 'hueforge_m600.mjs'
const BAT_NAME = 'prusa_m600.bat'
const CONFIG_NAME = 'config.ini'
const README_NAME = 'README.txt'

/** One filament swap: at the start of `layer`, change filament to `hex`. */
export interface SlicerSwap {
  /** 1-indexed slicer layer to swap at (same convention as Describe.txt). */
  layer: number
  /** Band boundary height in mm (z the swap fires just below). */
  zMm: number
  /** Hex of the filament that starts printing at this layer. */
  hex: string
  /** Human-readable filament name (en). */
  name: string
}

export interface SlicerSchedule {
  swaps: SlicerSwap[]
  totalLayers: number
  layerMm: number
}

/**
 * Filament swap schedule — the exact same math as Describe.txt so the STL,
 * 3MF, Describe and slicer bundle always agree. One swap per band boundary,
 * at the whole layer nearest the boundary. Bands thinner than half a layer
 * can share a boundary layer; only the color starting highest is reachable,
 * so the earlier swap is overwritten (one command per layer, never two).
 */
export function swapSchedule(result: PipelineResult): SlicerSchedule {
  const layerMm = result.settings.layerMm
  const layerAt = (z: number) => Math.max(1, Math.round(z / layerMm))
  const totalLayers = layerAt(result.settings.maxHeightMm)
  const bands = [...result.palette].sort((a, b) => a.topZMm - b.topZMm)
  const swaps: SlicerSwap[] = []
  for (let i = 0; i < bands.length - 1; i++) {
    const z = bands[i].topZMm
    if (z >= result.settings.maxHeightMm - 1e-9) continue // nothing prints above the model top
    const layer = Math.min(layerAt(z), totalLayers)
    const next = bands[i + 1]
    const hex = rgbToHex(next.color)
    const name = nearestFilament(next.color, 'en')
    const prev = swaps[swaps.length - 1]
    if (prev && prev.layer === layer) {
      prev.zMm = z
      prev.hex = hex
      prev.name = name
    } else {
      swaps.push({ layer, zMm: z, hex, name })
    }
  }
  return { swaps, totalLayers, layerMm }
}

/**
 * PrusaSlicer conditional layer-change G-code: one `{if layer_num == N}` per
 * swap so M600 fires exactly at the scheduled layers. Values are joined with
 * literal `\n` escapes — the INI encoding for multiline G-code values.
 */
export function buildLayerGcode(swaps: SlicerSwap[], command = 'M600'): string {
  return swaps
    .map((s) => `{if layer_num == ${s.layer}}; HueForge: switch to ${s.hex} (${s.name})\\n${command}{endif}`)
    .join('\\n')
}

/**
 * Partial PrusaSlicer configuration matching the exported model: layer
 * height, 100% infill, no supports, and the prewired M600 color changes.
 * Import via File → Import → Import Config… (or `prusa-slicer --load`).
 */
export function buildPrusaConfig(result: PipelineResult, command = 'M600'): string {
  const { swaps, totalLayers, layerMm } = swapSchedule(result)
  const n = result.palette.length
  return [
    '# HueForge Web — PrusaSlicer configuration bundle',
    '#',
    '# Import: PrusaSlicer → File → Import → Import Config…',
    '# (or command line: prusa-slicer --load config.ini model.3mf)',
    '#',
    `# Matches the exported model: ${n} colors, ${totalLayers} layers at ${layerMm} mm,`,
    '# 100% infill, no supports (the relief needs solid columns, not sparse fill).',
    '# The layer_gcode line fires the filament change automatically at each',
    '# scheduled swap layer — no manual color-change clicks needed.',
    `# Baked for layer height ${layerMm} mm: regenerate the bundle after`,
    '# changing the layer height in HueForge Web.',
    '# Klipper without M600: replace the command with PAUSE.',
    '# Requires PrusaSlicer 2.4+ (monotonic infill).',
    '',
    `layer_height = ${layerMm}`,
    'fill_density = 100%',
    'fill_pattern = monotonic',
    'support_material = 0',
    'support_material_auto = 0',
    `layer_gcode = ${buildLayerGcode(swaps, command)}`,
    '',
  ].join('\n')
}

/**
 * Self-contained Node.js post-processing script that inserts the swap
 * command into sliced G-code — the alternative to the config.ini method
 * when the user wants to keep their own print profile. PrusaSlicer runs
 * it after slicing with the G-code file as the argument; the file is
 * edited in place (PrusaSlicer renames it afterwards).
 */
export function buildM600Script(swaps: SlicerSwap[], command = 'M600'): string {
  const swapLines = swaps.map((s) => `  { layer: ${s.layer}, hex: '${s.hex}', name: '${s.name}' },`).join('\n')
  return `#!/usr/bin/env node
// HueForge Web — filament-change post-processing script for PrusaSlicer.
//
// Insert a filament-change command at the start of each scheduled layer.
// Baked for one specific export — remove it from the post-processing list
// when slicing other models.
//
// PrusaSlicer: Print Settings → Output options → Post-processing scripts
//   Windows:   add the path to prusa_m600.bat (wraps this file with node)
//   Linux/mac: add the path to this file directly (chmod +x once)
// Manual:  node ${SCRIPT_NAME} model.gcode [--out result.gcode]
import { readFileSync, writeFileSync } from 'node:fs'

const SWAP_COMMAND = '${command}' // Klipper without M600? change to 'PAUSE'
const SWAPS = [
${swapLines}
]

const argv = process.argv.slice(2)
const input = argv.find((a) => !a.startsWith('--'))
const oi = argv.indexOf('--out')
const output = oi !== -1 ? argv[oi + 1] : null
if (!input) {
  console.error('Usage: node ${SCRIPT_NAME} model.gcode [--out result.gcode]')
  process.exit(1)
}

// PrusaSlicer emits one ";LAYER_CHANGE" marker per layer (1-indexed in
// print order). Insert the swap right after the marker of the scheduled
// layer, before that layer's Z move and extrusions.
const lines = readFileSync(input, 'utf8').split('\\n')
const byLayer = new Map(SWAPS.map((s) => [s.layer, s]))
const out = []
let layerNo = 0
let inserted = 0
for (const line of lines) {
  out.push(line)
  if (/^;LAYER_CHANGE/.test(line)) {
    layerNo++
    const swap = byLayer.get(layerNo)
    if (swap) {
      out.push('; HueForge: switch to ' + swap.hex + ' (' + swap.name + ')')
      out.push(SWAP_COMMAND)
      inserted++
    }
  }
}
writeFileSync(output || input, out.join('\\n'))
console.error('HueForge M600: ' + layerNo + ' layers scanned, ' + inserted + ' swaps inserted.')
`
}

/** Windows wrapper — PrusaSlicer runs post-processing scripts through cmd. */
export function buildPrusaBat(): string {
  return [
    '@echo off',
    'REM HueForge Web — PrusaSlicer post-processing wrapper (Windows).',
    'REM Launches the Node.js script that sits next to this file.',
    `node "%~dp0${SCRIPT_NAME}" %*`,
    '',
  ].join('\n')
}

/** Bilingual README (en + ru) with the schedule and both setup methods. */
export function buildSlicerReadme(result: PipelineResult, modelName: string): string {
  const { swaps, totalLayers, layerMm } = swapSchedule(result)
  const n = result.palette.length
  const schedule = swaps.length
    ? swaps.map((s) => `  Layer ${s.layer} (z = ${s.zMm.toFixed(2)} mm) → ${s.hex} (${s.name})`).join('\n')
    : '  (single color — no swaps needed)'
  return `==============================================
HueForge Web — Slicer bundle (PrusaSlicer)
==============================================
Model: ${modelName} · ${n} colors
Layer height: ${layerMm} mm · ${totalLayers} layers · 100% infill · no supports

Swap schedule — fire the command at the START of these layers:
${schedule}

── EN ────────────────────────────────────────
METHOD A — import the config (recommended, no extra tools)
  1. Open the exported .3mf or .stl in PrusaSlicer (2.4+).
  2. File → Import → Import Config… → select ${CONFIG_NAME}.
     It sets layer height, 100% infill, no supports, and wires the M600
     filament changes into the layer-change G-code automatically.
  3. Slice — M600 fires at every scheduled layer.

METHOD B — post-processing script (needs Node.js)
  Keep your own print profile and post-process the G-code instead:
  1. Print Settings → Output options → Post-processing scripts → add:
       Windows:   full path to ${BAT_NAME}
       Linux/mac: full path to ${SCRIPT_NAME} (chmod +x once)
  2. Slice — the script inserts the swap commands into the G-code.
  Use only ONE method — both together would insert every swap twice.
  The script/config is baked for THIS export (${layerMm} mm layers) —
  regenerate the bundle after changing the layer height, and remove the
  script from the post-processing list when slicing other models.
  Klipper without M600: change M600 to PAUSE (SWAP_COMMAND in the script,
  or the layer_gcode line in ${CONFIG_NAME}).

── RU ────────────────────────────────────────
СПОСОБ A — импорт конфигурации (рекомендуется, без доп. программ)
  1. Откройте экспортированный .3mf или .stl в PrusaSlicer (2.4+).
  2. Файл → Импорт → Импорт конфигурации… → выберите ${CONFIG_NAME}.
     Зададутся высота слоя, заполнение 100%, без поддержек, а смены
     филамента M600 автоматически встроятся в G-код смены слоёв.
  3. Слайсируйте — M600 сработает на каждом запланированном слое.

СПОСОБ B — скрипт постобработки (нужен Node.js)
  Если хотите оставить свой профиль печати:
  1. Настройки печати → Опции вывода → Постобработка → добавьте:
       Windows:   полный путь к ${BAT_NAME}
       Linux/mac: полный путь к ${SCRIPT_NAME} (chmod +x)
  2. Слайс — скрипт вставит команды смены в готовый G-код.
  Используйте только ОДИН способ — иначе каждая смена продублируется.
  Скрипт и конфиг собраны под ЭТУ модель (${layerMm} мм слои) — после
  изменения высоты слоя пересоберите набор, а при слайсинге других
  моделей уберите скрипт из списка постобработки.
  Klipper без M600: замените M600 на PAUSE (SWAP_COMMAND в скрипте
  или строка layer_gcode в ${CONFIG_NAME}).
`
}

/**
 * The whole bundle as a zip: config.ini (prewired M600 layer changes),
 * the optional post-processing script, its Windows wrapper and a bilingual
 * README. Name it like the other exports: *-prusaslicer.zip.
 */
export function buildSlicerBundle(result: PipelineResult, modelName: string): Uint8Array {
  return zipSync(
    {
      [CONFIG_NAME]: strToU8(buildPrusaConfig(result)),
      [SCRIPT_NAME]: strToU8(buildM600Script(swapSchedule(result).swaps)),
      [BAT_NAME]: strToU8(buildPrusaBat()),
      [README_NAME]: strToU8(buildSlicerReadme(result, modelName)),
    },
    { level: 6 },
  )
}
