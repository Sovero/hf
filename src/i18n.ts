export type Lang = 'en' | 'ru'

const STORAGE_KEY = 'hf-lang'

export function isLang(v: string | null | undefined): v is Lang {
  return v === 'en' || v === 'ru'
}

export function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLang(saved)) return saved
  } catch {
    /* private mode */
  }
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

export function saveLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    /* private mode */
  }
}

type Dict = Record<string, Record<Lang, string>>

export const dict: Dict = {
  // ---- document / top bar ----
  docTitle: { en: 'HueForge Web — Filament Paintings', ru: 'HueForge Web — картины из филамента' },
  tagline: {
    en: 'Image → multi-layer 3D-printable filament painting',
    ru: 'Изображение → многослойная 3D-печатная картина из филамента',
  },
  themeLabel: { en: 'Theme', ru: 'Тема' },
  languageLabel: { en: 'Language', ru: 'Язык' },

  // ---- sidebar panel headings ----
  panelImage: { en: '1 · Image', ru: '1 · Изображение' },
  panelColors: { en: '2 · Colors', ru: '2 · Цвета' },
  panelDepth: { en: '3 · Depth mode', ru: '3 · Режим глубины' },
  panelSize: { en: '4 · Size & layers', ru: '4 · Размер и слои' },
  panelPrintability: { en: '5 · Printability check', ru: '5 · Проверка печатаемости' },
  panelExport: { en: '6 · Export', ru: '6 · Экспорт' },
  panelPalette: { en: 'Palette & print order', ru: 'Палитра и порядок печати' },

  // ---- drop zone / image ----
  dropTitle: { en: 'Drop an image here', ru: 'Перетащите изображение сюда' },
  dropHint: {
    en: 'or click to browse — PNG / JPG / WebP',
    ru: 'или нажмите, чтобы выбрать — PNG / JPG / WebP',
  },

  // ---- colors slider ----
  sliderHint: {
    en: 'Drag the slider, or type a count (2–24) in the box',
    ru: 'Потяните ползунок или введите число (2–24) в поле',
  },
  sliderAria: { en: 'Number of colors', ru: 'Количество цветов' },
  sliderValueAria: {
    en: 'Number of colors (type to set)',
    ru: 'Количество цветов (введите значение)',
  },
  tickTitle: { en: '{v} colors', ru: '{v} цветов' },

  // ---- depth mode ----
  depthDark: {
    en: 'Dark = tall (shadows on top)',
    ru: 'Тёмный = высокий (тени сверху)',
  },
  depthLight: {
    en: 'Light = tall (highlights on top)',
    ru: 'Светлый = высокий (светлые тона сверху)',
  },

  // ---- size & layers ----
  paramWidth: { en: 'Width', ru: 'Ширина' },
  paramHeight: { en: 'Height', ru: 'Высота' },
  paramBase: { en: 'Base', ru: 'Основание' },
  paramMax: { en: 'Max height', ru: 'Макс. высота' },
  unitMm: { en: 'mm', ru: 'мм' },
  sizeHint: {
    en: 'Colors are stacked as equal bands from base to max height.',
    ru: 'Цвета складываются равными полосами от основания до максимальной высоты.',
  },

  // ---- printability ----
  pbDefault: { en: 'Load an image to run the check.', ru: 'Загрузите изображение, чтобы выполнить проверку.' },
  allPassed: { en: 'All checks passed', ru: 'Все проверки пройдены' },

  // ---- palette ----
  paletteSummary: {
    en: '{colors} · export includes print order',
    ru: '{colors} · в файл включён порядок печати',
  },

  // ---- export ----
  btnStl: { en: 'Download STL', ru: 'Скачать STL' },
  btn3mf: { en: 'Download 3MF', ru: 'Скачать 3MF' },
  exportStlDone: { en: 'STL exported — {filename}', ru: 'STL экспортирован — {filename}' },
  export3mfDone: {
    en: '3MF exported — {filename} (colors + print order in metadata).',
    ru: '3MF экспортирован — {filename} (цвета и порядок печати в метаданных).',
  },

  // ---- viewers ----
  viewerSource: { en: 'Source', ru: 'Исходное' },
  viewerQuantized: { en: 'Color-reduced (print preview)', ru: 'Цветовое сокращение (предпросмотр печати)' },
  viewer3dTitle: { en: '3D preview', ru: '3D-предпросмотр' },
  viewer3dHint: { en: 'Drag to rotate · scroll to zoom', ru: 'Тяните, чтобы вращать · колесо — масштаб' },

  // ---- status / dynamic messages ----
  processing: { en: 'Processing…', ru: 'Обработка…' },
  ready: { en: 'Ready — {colors}.', ru: 'Готово — {colors}.' },
  processedAt: { en: 'Processed at {w}×{h}px', ru: 'Обработано: {w}×{h}px' },

  // ---- filament color names (palette legend) ----
  'filam.white': { en: 'White', ru: 'Белый' },
  'filam.bone': { en: 'Off-white / Bone', ru: 'Бежевый / Слоновая кость' },
  'filam.lightgray': { en: 'Light gray', ru: 'Светло-серый' },
  'filam.silver': { en: 'Silver / Gray', ru: 'Серебристый / Серый' },
  'filam.darkgray': { en: 'Dark gray', ru: 'Тёмно-серый' },
  'filam.black': { en: 'Black', ru: 'Чёрный' },
  'filam.red': { en: 'Red', ru: 'Красный' },
  'filam.darkred': { en: 'Dark red', ru: 'Тёмно-красный' },
  'filam.orange': { en: 'Orange', ru: 'Оранжевый' },
  'filam.yellow': { en: 'Yellow', ru: 'Жёлтый' },
  'filam.gold': { en: 'Gold', ru: 'Золотистый' },
  'filam.green': { en: 'Green', ru: 'Зелёный' },
  'filam.darkgreen': { en: 'Dark green', ru: 'Тёмно-зелёный' },
  'filam.lightblue': { en: 'Light blue', ru: 'Голубой' },
  'filam.blue': { en: 'Blue', ru: 'Синий' },
  'filam.darkblue': { en: 'Dark blue', ru: 'Тёмно-синий' },
  'filam.purple': { en: 'Purple', ru: 'Фиолетовый' },
  'filam.pink': { en: 'Pink / Magenta', ru: 'Розовый / Пурпурный' },
  'filam.brown': { en: 'Brown', ru: 'Коричневый' },
  'filam.tan': { en: 'Tan / Skin', ru: 'Телесный / Бежевый' },

  // ---- loadImage errors ----
  errNotAnImage: {
    en: '"{name}" is not an image file.',
    ru: '«{name}» — это не файл изображения.',
  },
  errTooLarge: {
    en: '"{name}" is {size} MB — larger than the 64 MB limit.',
    ru: '«{name}» весит {size} МБ — больше лимита 64 МБ.',
  },
  errDecode: {
    en: 'Could not decode the image. Try a PNG, JPEG, or WebP file.',
    ru: 'Не удалось декодировать изображение. Попробуйте PNG, JPEG или WebP.',
  },
  errDims: {
    en: 'Image dimensions {dims} exceed the {limit} px limit.',
    ru: 'Размеры изображения {dims} превышают лимит {limit} px.',
  },
  errCanvas: { en: 'Canvas is not available.', ru: 'Canvas недоступен.' },

  // ---- printability checks ----
  pbBandsTitleFail: {
    en: 'Color bands thinner than one layer',
    ru: 'Цветовые полосы тоньше одного слоя',
  },
  pbBandsDetailFail: {
    en: 'Each color is only {band} — less than a single {layer} layer, so bands cannot be printed as distinct sheets. Increase Max height or reduce the color count.',
    ru: 'Каждый цвет занимает всего {band} — меньше одного слоя {layer}, поэтому полосы не напечатаются как отдельные пластины. Увеличьте макс. высоту или уменьшите число цветов.',
  },
  pbBandsTitleWarn: { en: 'Thin color bands', ru: 'Тонкие цветовые полосы' },
  pbBandsDetailWarn: {
    en: 'Each color is {band} (~{layersText} @ {layer}) — thinner than the {nozzle} nozzle, so transitions will smear. Increase Max height or use fewer colors.',
    ru: 'Каждый цвет занимает {band} (~{layersText} по {layer}) — тоньше сопла {nozzle}, поэтому переходы будут размытыми. Увеличьте макс. высоту или уменьшите число цветов.',
  },
  pbBandsTitleOk: { en: 'Color band thickness', ru: 'Толщина цветовых полос' },
  pbBandsDetailOk: {
    en: 'Each color is {band} ≈ {layersText} @ {layer} — clean filament transitions.',
    ru: 'Каждый цвет занимает {band} ≈ {layersText} по {layer} — чистые переходы между цветами.',
  },
  pbResTitleFail: {
    en: 'Image cells far below nozzle width',
    ru: 'Ячейки изображения намного меньше сопла',
  },
  pbResDetailFail: {
    en: 'Each image cell is only {cell} — smaller than one {layer} layer; adjacent colors will merge into noise. Print much larger or use a smaller image.',
    ru: 'Каждая ячейка изображения всего {cell} — меньше одного слоя {layer}; соседние цвета сольются в шум. Печатайте значительно крупнее или используйте изображение меньшего размера.',
  },
  pbResTitleWarn: {
    en: 'Features smaller than the nozzle',
    ru: 'Детали меньше диаметра сопла',
  },
  pbResDetailWarn: {
    en: 'Each image cell is {cell} — below the {nozzle} nozzle, so fine detail will blend. Print larger (e.g. 200+ mm) to sharpen it.',
    ru: 'Каждая ячейка изображения — {cell}, что меньше сопла {nozzle}, поэтому мелкие детали сольются. Увеличьте размер печати (например, от 200 мм), чтобы их сохранить.',
  },
  pbResTitleOk: {
    en: 'Feature resolution vs nozzle',
    ru: 'Разрешение деталей и сопло',
  },
  pbResDetailOk: {
    en: 'Each image cell is {cell} — at or above the {nozzle} nozzle; fine detail is preserved.',
    ru: 'Каждая ячейка изображения — {cell}, что не меньше сопла {nozzle}; мелкие детали сохраняются.',
  },
  pbSwapsTitleWarn: { en: 'Many filament changes', ru: 'Много смен филамента' },
  pbSwapsDetailWarn: {
    en: '{colorsText} = {swapsText} (plus purge towers) over ~{layersText} — a long, hands-on print. Consider fewer colors.',
    ru: '{colorsText} = {swapsText} (плюс башни очистки) на ~{layersText} — долгая и трудоёмкая печать. Попробуйте меньше цветов.',
  },
  pbSwapsTitleOk: { en: 'Filament changes', ru: 'Смены филамента' },
  pbSwapsDetailOk: {
    en: '{colorsText} = {swapsText} over ~{layersText} — manageable.',
    ru: '{colorsText} = {swapsText} на ~{layersText} — приемлемо.',
  },
  pbSupportTitleWarn: { en: 'Fragile isolated regions', ru: 'Хрупкие изолированные участки' },
  pbSupportDetailWarn: {
    en: 'All walls are vertical (≤90°) and every layer rests on material below, so no supports or true overhangs exist — but {regionsText} (under 3×3 cells, ~{fraction}% of the image) will print as fragile towers or speckles. Smooth the image or reduce the color count.',
    ru: 'Все стены вертикальны (≤90°) и каждый слой опирается на материал снизу, поэтому поддержки не нужны — но {regionsText} (меньше 3×3 ячеек, ~{fraction}% изображения) напечатаются как хрупкие столбики или крапинки. Сгладьте изображение или уменьшите число цветов.',
  },
  pbSupportTitleOk: { en: 'Support & overhangs', ru: 'Поддержки и нависания' },
  pbSupportDetailOk: {
    en: 'All walls are vertical (≤90°) and every layer is supported from below — no supports needed, no overhang risk.',
    ru: 'Все стены вертикальны (≤90°) и каждый слой опирается на нижний — поддержки не нужны, нависаний нет.',
  },
}

export function t(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const entry = dict[key]
  if (!entry) throw new Error(`Missing i18n key: ${key}`)
  let out = entry[lang]
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out = out.replaceAll(`{${k}}`, String(v))
    }
  }
  return out
}

/** Word forms for pluralization: [one, few, many] (ru), [one, other] (en). */
type PluralForms = { en: [string, string]; ru: [string, string, string] }

const WORDS: Record<string, PluralForms> = {
  colors: { en: ['color', 'colors'], ru: ['цвет', 'цвета', 'цветов'] },
  layers: { en: ['layer', 'layers'], ru: ['слой', 'слоя', 'слоёв'] },
  errors: { en: ['error', 'errors'], ru: ['ошибка', 'ошибки', 'ошибок'] },
  warnings: { en: ['warning', 'warnings'], ru: ['предупреждение', 'предупреждения', 'предупреждений'] },
  swaps: { en: ['change', 'changes'], ru: ['смена', 'смены', 'смен'] },
  regions: { en: ['region', 'regions'], ru: ['участок', 'участка', 'участков'] },
}

function ruForm(n: number, forms: [string, string, string]): string {
  // Fractional counts (1.6, 2.3, 0.5) always take the "few" form: 1.6 слоя.
  if (n % 1 !== 0) return forms[1]
  const abs = Math.abs(Math.trunc(n))
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

/** "1 color / 2 colors / 5 цветов" — the word only, caller joins the number. */
export function word(lang: Lang, n: number, wordKey: keyof typeof WORDS): string {
  const forms = WORDS[wordKey][lang]
  if (lang === 'en') return `${n} ${forms[0] === forms[1] || n === 1 ? forms[0] : forms[1]}`
  return `${n} ${ruForm(n, forms as [string, string, string])}`
}

/** "0.40 mm" / "0.40 мм". */
export function mmOf(lang: Lang, v: number): string {
  const text = v.toFixed(2)
  return lang === 'ru' ? `${text} мм` : `${text} mm`
}
