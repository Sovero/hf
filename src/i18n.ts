export type Lang = 'en' | 'ru'

const STORAGE_KEY = 'hf-lang'
const DISMISS_KEY = 'hf-lang-prompt-dismissed'

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

/** True when the user already made a language choice (or skipped the prompt). */
export function hasLangPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null || localStorage.getItem(DISMISS_KEY) !== null
  } catch {
    return true // private mode: never nag
  }
}

export function dismissLangPrompt() {
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* private mode */
  }
}

type Dict = Record<string, Record<Lang, string>>

export const dict: Dict = {
  // ---- help: section intros and control tooltips (en/ru) ----
  helpWelcome: {
    en: 'Welcome! Turn any picture into a multi-color 3D-printed painting: load an image, pick how many filament colors to use, and download the model with a color-swap guide. Work through the numbered sections top to bottom — the previews update live.',
    ru: 'Добро пожаловать! Превратите любую картинку в многоцветную 3D-печатную картину: загрузите изображение, выберите количество цветов филамента и скачайте модель с инструкцией по смене цвета. Проходите пронумерованные разделы сверху вниз — предпросмотры обновляются сразу.',
  },
  helpImage: {
    en: 'Start here. Drop in a photo or drawing — the app will reduce it to flat color bands for printing.',
    ru: 'Начните здесь. Загрузите фото или рисунок — приложение сведёт его к плоским цветовым полосам для печати.',
  },
  helpDropZone: {
    en: 'Click to choose a file, or drag an image onto this area. PNG, JPG and WebP work best.',
    ru: 'Нажмите, чтобы выбрать файл, или перетащите изображение на эту область. Лучше всего подходят PNG, JPG и WebP.',
  },
  helpColors: {
    en: 'How many filament colors to print with. More colors = smoother shading, but more manual filament swaps.',
    ru: 'Сколько цветов филамента использовать. Больше цветов — плавнее переходы, но больше ручных смен филамента.',
  },
  helpColorsSlider: {
    en: 'Drag to change the color count; click a tick mark for a quick preset (2–24).',
    ru: 'Потяните, чтобы изменить количество цветов; щёлкните по метке для быстрого выбора (2–24).',
  },
  helpColorsValue: {
    en: 'Type an exact color count from 2 to 24 and press Enter.',
    ru: 'Введите точное количество цветов от 2 до 24 и нажмите Enter.',
  },
  helpDepth: {
    en: 'Which parts of the picture stand tallest: light areas or dark ones. This sets the print order of the colors.',
    ru: 'Какие участки картинки самые высокие — светлые или тёмные. Это задаёт порядок печати цветов.',
  },
  helpDepthLight: {
    en: 'Highlights print last, on top — good for light-on-dark pictures.',
    ru: 'Светлые участки печатаются последними, сверху — подходит для светлого на тёмном фоне.',
  },
  helpDepthDark: {
    en: 'Shadows print last, on top — good for dark-on-light pictures.',
    ru: 'Тёмные участки печатаются последними, сверху — подходит для тёмного на светлом фоне.',
  },
  helpSize: {
    en: 'Physical print dimensions and layer settings. The resolution of the working image adapts to the print size automatically.',
    ru: 'Физические размеры печати и настройки слоёв. Разрешение рабочего изображения подстраивается под размер печати автоматически.',
  },
  helpWidth: {
    en: 'Print width in millimeters (20–500).',
    ru: 'Ширина печати в миллиметрах (20–500).',
  },
  helpHeight: {
    en: 'Print height in millimeters (20–500).',
    ru: 'Высота печати в миллиметрах (20–500).',
  },
  helpBase: {
    en: 'Thickness of the solid base slab the color bands build on (0–5 mm).',
    ru: 'Толщина сплошной подложки, на которой растут цветовые полосы (0–5 мм).',
  },
  helpMax: {
    en: 'Total model height including the base (2–40 mm). Each color band occupies part of it.',
    ru: 'Полная высота модели вместе с подложкой (2–40 мм). Каждый цвет занимает свою часть.',
  },
  helpLayerMm: {
    en: 'Slicer layer height (0.04–0.6 mm). Color swaps always land exactly on a layer boundary.',
    ru: 'Высота слоя в слайсере (0,04–0,6 мм). Смены цвета всегда попадают точно на границу слоя.',
  },
  helpPrintability: {
    en: 'Automatic check of your settings: band thickness, detail size vs nozzle, fragile specks, and the number of swaps. Fix anything marked with ⚠ or ✕.',
    ru: 'Автоматическая проверка настроек: толщина полос, размер деталей против сопла, хрупкие участки и число смен. Исправьте всё, что помечено ⚠ или ✕.',
  },
  helpReference: {
    en: 'Have a finished HueForge or Bambu project? Drop its 3MF here to see its size, colors and swap schedule — and copy them into your work with one click.',
    ru: 'Есть готовый проект HueForge или Bambu? Загрузите его 3MF сюда, чтобы увидеть размер, цвета и расписание смен — и перенести их в свою работу одним нажатием.',
  },
  helpRefDrop: {
    en: 'Click or drop a .3mf file. Analysis is read-only — nothing changes until you press Apply.',
    ru: 'Нажмите или перетащите файл .3mf. Анализ только читает файл — ничего не меняется, пока вы не нажмёте «Применить».',
  },
  helpRefApply: {
    en: 'Copy the reference’s sizes, colors and swap schedule onto your current image. Your image itself is never replaced.',
    ru: 'Перенести размеры, цвета и расписание смен из эталона на текущее изображение. Само изображение не заменяется.',
  },
  helpExport: {
    en: 'Download the printable files. Print the model top face up, 100% infill, no supports.',
    ru: 'Скачайте файлы для печати. Печатайте модель верхней стороной вверх, заполнение 100%, поддержки не нужны.',
  },
  helpBtnStl: {
    en: 'The 3D geometry only — opens in any slicer. Colors are encoded by layer height; pair it with Describe.txt.',
    ru: 'Только 3D-геометрия — открывается в любом слайсере. Цвета закодированы высотой слоёв; используйте вместе с Describe.txt.',
  },
  helpBtn3mf: {
    en: 'Project file for Bambu Studio (and HueForge-compatible slicers) with filament colors and swap points already set.',
    ru: 'Файл проекта для Bambu Studio (и совместимых слайсеров) с цветами филамента и точками смен уже внутри.',
  },
  helpBtnDescribe: {
    en: 'A text guide: color order from the base up and the exact layer to swap each filament.',
    ru: 'Текстовая инструкция: порядок цветов от основания и точный слой для смены каждого филамента.',
  },
  helpBtnSlicer: {
    en: 'ZIP for PrusaSlicer: config.ini (layer height, 100% infill, no supports) with M600 color changes prewired into the layer-change G-code, plus an optional post-processing script and a bilingual README.',
    ru: 'ZIP для PrusaSlicer: config.ini (высота слоя, заполнение 100%, без поддержек) со сменами цвета M600, уже встроенными в G-код смены слоёв, плюс опциональный скрипт постобработки и инструкция на двух языках.',
  },
  helpOpenSlicer: {
    en: 'Sends the exported 3MF (with color swaps) straight to a slicer installed on this PC. Available only when the local server is started with the opt-in flag (deploy-slicer.bat or --allow-slicer).',
    ru: 'Отправляет собранный 3MF (со сменами цвета) сразу в слайсер, установленный на этом ПК. Доступно, только если локальный сервер запущен с флагом (deploy-slicer.bat или --allow-slicer).',
  },
  helpPalette: {
    en: 'Your colors in print order. Click a swatch to change it, ★ to pick a real filament from a Russian manufacturer’s catalog, ↺ to reset.',
    ru: 'Ваши цвета в порядке печати. Щёлкните по образцу, чтобы изменить цвет; ★ — выбрать реальный филамент из каталога российских производителей; ↺ — вернуть.',
  },
  paletteTau: {
    en: 'Opacity length τ (mm): the thickness that hides ~63% of the layer below. Bigger = more opaque. Calibrate per spool with a swatch for accurate previews.',
    ru: 'Длина пропускания τ (мм): толщина, скрывающая ~63% слоя ниже. Больше = плотнее. Для точных предпросмотров откалибруйте филамент по образцу.',
  },
  calibIntro: {
    en: 'Per-filament opacity: print the swatch for a color, photograph it, and the app fits τ from your photo — previews then match the real spool.',
    ru: 'Непрозрачность каждого филамента: распечатайте образец для выбранного цвета, сфотографируйте его — приложение подберёт τ по вашему фото, и предпросмотр совпадёт с реальной катушкой.',
  },
  calibDownload: { en: 'Swatch STL', ru: 'Образец STL' },
  calibDownloadDone: {
    en: 'Calibration swatch exported — {filename} (+ instructions .txt).',
    ru: 'Образец для калибровки экспортирован — {filename} (+ инструкция .txt).',
  },
  calibClickBase: {
    en: 'Photo loaded. Click the bare base area (no step) first.',
    ru: 'Фото загружено. Сначала щёлкните по чистому основанию (без ступени).',
  },
  calibClickStep: {
    en: 'Click step {n} of {total} ({t} mm) — from thinnest to thickest.',
    ru: 'Щёлкните ступень {n} из {total} ({t} мм) — от тонкой к толстой.',
  },
  calibFitDone: {
    en: 'Fitted τ = {tau} mm for this filament — previews updated.',
    ru: 'Подобрано τ = {tau} мм для этого филамента — предпросмотры обновлены.',
  },
  helpViewerSource: {
    en: 'The original picture you loaded.',
    ru: 'Исходная картинка, которую вы загрузили.',
  },
  helpViewerQuantized: {
    en: 'The final printed picture: what the top of the model will look like.',
    ru: 'Итоговая картина печати: так будет выглядеть верх модели.',
  },
  helpViewerLayers: {
    en: 'The print in progress. Move the slider to flip through the layers — finished areas keep their color, the rest shows the filament currently being extruded.',
    ru: 'Процесс печати. Двигайте ползунок, чтобы листать слои: готовые участки сохраняют свой цвет, остальное показывает текущий филамент.',
  },
  helpLayerSlider: {
    en: 'Print layer number. Ticks mark the layers where the filament changes — click one to jump there.',
    ru: 'Номер слоя печати. Метки — слои смены филамента; щёлкните, чтобы перейти к ним.',
  },
  helpViewer3d: {
    en: 'The 3D model itself: each color is a raised sheet of its own height. Drag to rotate, scroll to zoom.',
    ru: 'Сама 3D-модель: каждый цвет — приподнятый лист своей высоты. Тяните, чтобы вращать, колесо — масштаб.',
  },
  helpLangSelect: {
    en: 'Switch the interface language.',
    ru: 'Переключение языка интерфейса.',
  },
  helpThemeSelect: {
    en: 'Interface color theme — the choice is remembered.',
    ru: 'Цветовая тема интерфейса — выбор запоминается.',
  },

  // ---- document / top bar ----
  docTitle: { en: 'HueForge Web — Filament Paintings', ru: 'HueForge Web — картины из филамента' },
  tagline: {
    en: 'Image → multi-layer 3D-printable filament painting',
    ru: 'Изображение → многослойная 3D-печатная картина из филамента',
  },
  themeLabel: { en: 'Theme', ru: 'Тема' },
  languageLabel: { en: 'Language', ru: 'Язык' },
  bannerTitle: { en: 'Choose your language and theme', ru: 'Выберите язык и тему' },
  bannerHint: {
    en: 'You can change both anytime from the top bar.',
    ru: 'Оба можно изменить в любой момент в верхней панели.',
  },
  bannerStart: { en: 'Start', ru: 'Начать' },
  bannerKeep: {
    en: 'Skip — use the defaults',
    ru: 'Пропустить — оставить по умолчанию',
  },
  themeDark: { en: 'Dark', ru: 'Тёмная' },
  themeLight: { en: 'Light', ru: 'Светлая' },

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
  ditherHint: {
    en: 'Dithering scatters band boundaries into smooth gradients (Floyd–Steinberg). 0 = off.',
    ru: 'Дизеринг размывает границы полос в плавные градиенты (Флойда–Стейнберга). 0 = выкл.',
  },
  helpDither: {
    en: 'Error-diffusion strength: at higher values the boundary between two filaments becomes a dithered mix of both instead of a hard step — smoother gradients, but more tiny regions. Applies on reprocess; exports include it.',
    ru: 'Сила дизеринга: чем выше, тем больше граница двух филаментов превращается в их смесь, а не резкую ступень — градиенты плавнее, но мелких участков больше. Применяется при пересчёте и попадает в экспорт.',
  },
  sliderAria: { en: 'Number of colors', ru: 'Количество цветов' },
  sliderValueAria: {
    en: 'Number of colors (type to set)',
    ru: 'Количество цветов (введите значение)',
  },
  tickTitle: { en: '{v} colors', ru: '{v} цветов' },

  // ---- depth mode ----
  depthDark: {
    en: 'Dark image areas stand tallest (printed last, on top)',
    ru: 'Тёмные участки изображения — самые высокие (печатаются последними, сверху)',
  },
  depthLight: {
    en: 'Bright image areas stand tallest (highlights printed last, on top)',
    ru: 'Светлые участки изображения — самые высокие (печатаются последними, сверху)',
  },

  // ---- size & layers ----
  paramWidth: { en: 'Width', ru: 'Ширина' },
  paramHeight: { en: 'Height', ru: 'Высота' },
  paramBase: { en: 'Base', ru: 'Основание' },
  paramMax: { en: 'Max height', ru: 'Макс. высота' },
  paramLayer: { en: 'Layer height', ru: 'Высота слоя' },
  unitMm: { en: 'mm', ru: 'мм' },
  sizeHint: {
    en: 'Each of the N colors prints as a flat sheet of its own height: every pixel of a color stands at the same height, so the top surface is smooth and a color switch always happens between whole layers — one color per printed layer.',
    ru: 'Каждый из N цветов печатается как плоский лист своей высоты: все пиксели одного цвета стоят на одной высоте, поэтому верхняя поверхность гладкая, а смена цвета всегда происходит между целыми слоями — один цвет на слой.',
  },

  // ---- printability ----
  pbDefault: { en: 'Load an image to run the check.', ru: 'Загрузите изображение, чтобы выполнить проверку.' },
  allPassed: { en: 'All checks passed', ru: 'Все проверки пройдены' },

  // ---- palette ----
  paletteSummary: {
    en: '{colors} · export includes print order',
    ru: '{colors} · в файл включён порядок печати',
  },
  paletteChange: {
    en: 'Change this color (pick a filament color)',
    ru: 'Изменить этот цвет (выберите цвет филамента)',
  },
  paletteReset: {
    en: 'Reset to the auto-detected color',
    ru: 'Вернуть автоматически подобранный цвет',
  },
  filamLibraryTitle: { en: 'Filament library', ru: 'Библиотека филамента' },
  filamLibraryHint: {
    en: 'Pick a real filament from a Russian manufacturer for this band — brand, material, color.',
    ru: 'Подберите реальный филамент российского производителя для этой полосы — бренд, материал, цвет.',
  },
  filamBrandLabel: { en: 'Brand', ru: 'Бренд' },
  filamMaterialLabel: { en: 'Material', ru: 'Материал' },
  filamColorLabel: { en: 'Color', ru: 'Цвет' },
  filamPick: { en: 'Pick filament', ru: 'Выбрать филамент' },
  filamClear: { en: 'Clear choice', ru: 'Сбросить выбор' },
  filamClose: { en: 'Close', ru: 'Закрыть' },
  filamCustom: { en: 'custom color', ru: 'свой цвет' },
  filamSite: { en: 'Open manufacturer site', ru: 'Открыть сайт производителя' },
  filamAssigned: { en: 'assigned', ru: 'назначен' },
  filamSuggested: { en: 'suggested', ru: 'подходящий' },

  // ---- custom filaments ("My filaments") ----
  filamMyBrand: { en: 'My filaments', ru: 'Мои филаменты' },
  filamAddTitle: { en: 'Add own filament', ru: 'Добавить свой филамент' },
  filamAddName: { en: 'Name', ru: 'Название' },
  filamAddNamePlaceholder: { en: 'e.g. Red from spool #2', ru: 'напр. Красный с катушки №2' },
  filamAddColor: { en: 'Color', ru: 'Цвет' },
  filamAddBtn: { en: 'Add', ru: 'Добавить' },
  filamAdded: { en: 'Saved — pick it in My filaments', ru: 'Сохранён — выберите его в «Мои филаменты»' },
  filamDelete: { en: 'Delete this filament', ru: 'Удалить этот филамент' },
  filamDeleteConfirm: {
    en: 'Delete this custom filament? Bands using it keep the color but lose the label.',
    ru: 'Удалить этот филамент? Полосы, где он был выбран, сохранят цвет, но потеряют подпись.',
  },
  filamMyEmpty: {
    en: 'No own filaments yet — add the spools you actually print with.',
    ru: 'Пока нет своих филаментов — добавьте катушки, которыми печатаете.',
  },

  // ---- export ----
  btnStl: { en: 'Download STL', ru: 'Скачать STL' },
  btn3mf: { en: 'Download 3MF', ru: 'Скачать 3MF' },
  btnDescribe: { en: 'Download Describe.txt', ru: 'Скачать Describe.txt' },
  btnSlicer: { en: 'Slicer bundle', ru: 'Набор для слайсера' },
  btnOpenSlicer: { en: 'Open in slicer', ru: 'Открыть в слайсере' },
  exportStlDone: { en: 'STL exported — {filename}', ru: 'STL экспортирован — {filename}' },
  describeDone: { en: 'Describe.txt exported — {filename}', ru: 'Describe.txt экспортирован — {filename}' },
  slicerDone: {
    en: 'Slicer bundle exported — {filename} (PrusaSlicer: File → Import → Import Config…).',
    ru: 'Набор для слайсера экспортирован — {filename} (PrusaSlicer: Файл → Импорт → Импорт конфигурации…).',
  },
  openSlicerDone: {
    en: 'Model sent to {slicer} — check its window.',
    ru: 'Модель отправлена в {slicer} — смотрите его окно.',
  },
  openSlicerError: {
    en: 'Could not open in slicer: {detail}',
    ru: 'Не удалось открыть в слайсере: {detail}',
  },
  export3mfDone: {
    en: '3MF exported — {filename} (Bambu Studio project with color swaps).',
    ru: '3MF экспортирован — {filename} (проект Bambu Studio со сменами цвета).',
  },

  // ---- viewers ----
  viewerSource: { en: 'Source', ru: 'Исходное' },
  viewerQuantized: { en: 'Color-reduced (print preview)', ru: 'Цветовое сокращение (предпросмотр печати)' },
  lightFront: { en: 'Front-lit', ru: 'Со стороны света' },
  lightBack: { en: 'Backlight', ru: 'На просвет' },
  lightNoteFront: {
    en: 'Front-lit: opaque base behind the print — thin top sheets let lower colors shine through.',
    ru: 'Со стороны света: позади непрозрачная подложка — тонкие верхние листы пропускают нижние цвета.',
  },
  lightNoteBack: {
    en: 'Backlit: light passes through the whole stack — thin dark areas glow where light leaks through.',
    ru: 'На просвет: свет проходит через весь стек — тонкие тёмные участки светятся там, где просачивается свет.',
  },
  helpLightToggle: {
    en: 'Switch how the preview is lit. Front-lit is the wall look (opaque base behind the print). Backlight simulates the print lit from behind — the classic HueForge lamp/window display — where thin dark areas glow because light leaks through them. Both use your per-filament τ values.',
    ru: 'Переключает освещение предпросмотра. «Со стороны света» — вид на стене (позади непрозрачная подложка). «На просвет» — печать, подсвеченная сзади, как классическая настенная картина HueForge у лампы или окна: тонкие тёмные участки светятся, потому что свет сквозь них проходит. Оба режима используют ваши значения τ для каждого филамента.',
  },
  viewer3dTitle: { en: '3D preview', ru: '3D-предпросмотр' },
  viewer3dHint: { en: 'Drag to rotate · scroll to zoom', ru: 'Тяните, чтобы вращать · колесо — масштаб' },

  // ---- layer view ----
  viewerLayers: { en: 'Layer-by-layer view', ru: 'Просмотр по слоям' },
  layerSliderLabel: { en: 'Print layer', ru: 'Слой печати' },
  layerOfTotal: { en: 'Layer {n} of {total} (z = {z} mm)', ru: 'Слой {n} из {total} (z = {z} мм)' },
  layerSwappingTo: { en: 'printing color #{n} · {name}', ru: 'печатается цвет #{n} · {name}' },
  layerTopDone: { en: 'final layer — full picture', ru: 'финальный слой — полная картина' },
  layerBase: { en: 'base slab', ru: 'подложка' },
  layerTransNote: {
    en: 'Colors blend like real translucent filament: thin top sheets let the layers below shine through, so the preview matches the finished print.',
    ru: 'Цвета смешиваются, как в реальном полупрозрачном филаменте: тонкие верхние слои просвечивают, и низ проглядывает сквозь них — предпросмотр совпадает с готовой картиной.',
  },

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

  // ---- reference 3MF panel ----
  panelReference: { en: 'Reference 3MF', ru: 'Эталонный 3MF' },
  refDropTitle: { en: 'Drop a reference .3mf here', ru: 'Перетащите эталонный .3mf сюда' },
  refDropHint: {
    en: 'or click to browse — analyze first, apply only if it fits',
    ru: 'или нажмите, чтобы выбрать — сначала анализ, применение отдельно',
  },
  refBadgeEmpty: {
    en: 'Not loaded',
    ru: 'Не загружен',
  },
  refBadgeReady: {
    en: 'File loaded',
    ru: 'Файл загружен',
  },
  refBadgeComplete: {
    en: 'Analyzed ✓',
    ru: 'Проанализирован ✓',
  },
  refBadgePartial: {
    en: 'Analyzed (partial)',
    ru: 'Проанализирован (частично)',
  },
  refBadgeError: {
    en: 'Error',
    ru: 'Ошибка',
  },
  refBadgeAnalyzing: {
    en: 'Analyzing…',
    ru: 'Анализ…',
  },
  refEmpty: {
    en: 'Analyze a reference 3MF (HueForge, Bambu Studio, or this app’s export) to compare its size, colors, and swap schedule.',
    ru: 'Проанализируйте эталонный 3MF (HueForge, Bambu Studio или экспорт этого приложения), чтобы сравнить размер, цвета и расписание смен.',
  },
  refAnalyzing: { en: 'Analyzing…', ru: 'Анализ…' },
  refComplete: { en: 'Complete report', ru: 'Полный отчёт' },
  refPartial: { en: 'Partial report', ru: 'Неполный отчёт' },
  refModelTitle: { en: 'Model', ru: 'Модель' },
  refModelLine: {
    en: '{w}×{h} mm footprint · top at {z} mm · {tris} · {unit}',
    ru: 'Основание {w}×{h} мм · верх на {z} мм · {tris} · {unit}',
  },
  refPaletteTitle: { en: 'Palette & print order', ru: 'Палитра и порядок печати' },
  refSwapsTitle: { en: 'Swap schedule', ru: 'Расписание смен' },
  refSwapLine: { en: 'z = {z} mm{layer}', ru: 'z = {z} мм{layer}' },
  refSwapLayer: { en: ' · layer {layer}', ru: ' · слой {layer}' },
  refNoSwaps: { en: 'No tool-change schedule found.', ru: 'Расписание смен не найдено.' },
  refMissingTitle: { en: 'Not found in file', ru: 'Не найдено в файле' },
  refWarningsTitle: { en: 'Notes', ru: 'Примечания' },
  refApply: { en: 'Apply to editor', ru: 'Применить к редактору' },
  refNeedsImage: {
    en: 'Load an image first — a reference only adjusts settings around it.',
    ru: 'Сначала загрузите изображение — эталон лишь подстраивает настройки под него.',
  },
  refBlocked: { en: 'Cannot apply: {reason}', ru: 'Нельзя применить: {reason}' },
  refAppliedTitle: { en: 'Applied', ru: 'Применено' },
  refKeptTitle: { en: 'Kept current', ru: 'Оставлено текущим' },
  refFallbackTitle: { en: 'Derived from the image', ru: 'Взято из изображения' },
  refAppliedDone: {
    en: 'Reference applied — reprocessed with {colors}.',
    ru: 'Эталон применён — цветов теперь: {colors}.',
  },
  refError: { en: 'Could not read the reference.', ru: 'Не удалось прочитать эталон.' },
  refErrExtension: {
    en: 'Choose a .3mf reference file.',
    ru: 'Выберите файл-эталон в формате .3mf.',
  },
  refErrSize: {
    en: 'The reference file is empty or exceeds the 100 MB limit.',
    ru: 'Файл-эталон пуст или превышает лимит 100 МБ.',
  },
  refErrArchive: {
    en: 'The reference is not a valid 3MF ZIP archive.',
    ru: 'Эталон — не корректный ZIP-архив 3MF.',
  },
  refErrMissingModel: {
    en: 'The 3MF model part is missing.',
    ru: 'В 3MF отсутствует часть с моделью.',
  },
  refErrEntrySize: {
    en: 'A 3MF metadata part exceeds the 25 MB limit.',
    ru: 'Часть метаданных 3MF превышает лимит 25 МБ.',
  },
  refErrXml: {
    en: 'The 3MF model XML is incomplete or malformed.',
    ru: 'XML модели в 3MF неполный или повреждён.',
  },
  refErrUnit: {
    en: 'The 3MF uses an unsupported unit of measurement.',
    ru: 'В 3MF используются неподдерживаемые единицы измерения.',
  },
  refFieldColorCount: { en: 'Color count', ru: 'Кол-во цветов' },
  refFieldWidthMm: { en: 'Width', ru: 'Ширина' },
  refFieldHeightMm: { en: 'Height', ru: 'Высота' },
  refFieldBaseMm: { en: 'Base', ru: 'Основание' },
  refFieldMaxHeightMm: { en: 'Max height', ru: 'Макс. высота' },
  refFieldLayerMm: { en: 'Layer height', ru: 'Высота слоя' },
  refFieldDepthMode: { en: 'Depth mode', ru: 'Режим глубины' },
  refFieldPalette: { en: 'Palette', ru: 'Палитра' },
  refFieldSchedule: { en: 'Swap schedule', ru: 'Расписание смен' },

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
    en: 'All walls are vertical (≤90°) and every layer rests on material below, so no supports or true overhangs exist. Fragile isolated regions are merged into their surroundings automatically, but {regionsText} (under 3×3 cells, ~{fraction}% of the image) remain — each pass merges more, and a higher color count or a smoother image removes the rest.',
    ru: 'Все стены вертикальны (≤90°) и каждый слой опирается на материал снизу, поэтому поддержки не нужны. Хрупкие изолированные участки автоматически сливаются с окружением, но {regionsText} (меньше 3×3 ячеек, ~{fraction}% изображения) ещё остаются — при каждом проходе их сливается больше, а большее число цветов или более гладкое изображение уберёт остальные.',
  },
  pbSupportDitherNote: {
    en: 'Dithering is on: isolated dots at band boundaries are intentional gradient texture and are counted on the pre-dither map.',
    ru: 'Дизеринг включён: отдельные точки на границах полос — намеренная градиентная текстура; подсчёт ведётся по карте до дизеринга.',
  },
  pbSupportDetailOkDither: {
    en: 'Dithering is on — the analysis judges the pre-dither map, so intentional dither dots do not count as fragile specks.',
    ru: 'Дизеринг включён — анализ ведётся по карте до дизеринга, поэтому намеренные точки дизеринга не считаются хрупкими участками.',
  },
  pbSupportTitleOk: { en: 'Support & overhangs', ru: 'Поддержки и нависания' },
  pbSupportDetailOk: {
    en: 'All walls are vertical (≤90°) and every layer is supported from below — no supports needed, no overhang risk. Fragile isolated regions were flattened automatically.',
    ru: 'Все стены вертикальны (≤90°) и каждый слой опирается на нижний — поддержки не нужны, нависаний нет. Хрупкие изолированные участки сглажены автоматически.',
  },

  // ---- welcome panel + guided tour ----
  welcomeTitle: { en: 'Welcome to HueForge Web', ru: 'Добро пожаловать в HueForge Web' },
  welcomeTourBtn: { en: 'Start the tour', ru: 'Начать тур' },
  welcomeDismiss: { en: 'Hide', ru: 'Скрыть' },
  tourBtn: { en: 'Tour', ru: 'Тур' },
  helpTour: {
    en: 'Restart the guided tour that walks you through every section.',
    ru: 'Перезапустить ознакомительный тур по всем разделам.',
  },
  tourIntroTitle: { en: 'A quick tour', ru: 'Короткий тур' },
  tourIntro: {
    en: 'This app turns any picture into a multi-color 3D-printed painting: load an image, pick how many filament colors to use, and download the model with a color-swap guide. Follow the numbered sections top to bottom — the previews update live.',
    ru: 'Приложение превращает любую картинку в многоцветную 3D-печатную картину: загрузите изображение, выберите количество цветов филамента и скачайте модель с инструкцией по смене цвета. Проходите пронумерованные разделы сверху вниз — предпросмотры обновляются сразу.',
  },
  tourDoneTitle: { en: "You're all set", ru: 'Всё готово' },
  tourDone: {
    en: 'Load an image, tune the colors and size, then download the STL, 3MF or Describe.txt and slice with 100% infill and no supports. You can restart this tour anytime from the Tour button in the top bar.',
    ru: 'Загрузите изображение, настройте цвета и размер, затем скачайте STL, 3MF или Describe.txt и нарежьте в слайсере с заполнением 100% без поддержек. Тур можно запустить снова кнопкой «Тур» в верхней панели.',
  },
  tourSkip: { en: 'Skip', ru: 'Пропустить' },
  tourPrev: { en: 'Back', ru: 'Назад' },
  tourNext: { en: 'Next', ru: 'Далее' },
  tourFinish: { en: 'Finish', ru: 'Завершить' },
  tourStep: { en: 'Step {n} of {total}', ru: 'Шаг {n} из {total}' },
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
  tris: { en: ['triangle', 'triangles'], ru: ['треугольник', 'треугольника', 'треугольников'] },
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
