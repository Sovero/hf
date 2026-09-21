# Сглаживание рельефа и чистые заливки — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать «гималаи» и размазанность цветов на фотографиях: bilateral-сглаживание в двух точках пайплайна (RGB до квантования + карта рельефа), один ползунок «Сглаживание» 0–100% (дефолт 30%).

**Architecture:** Новый чистый модуль `src/lib/smooth.ts` с двумя bilateral-фильтрами. Врезка в `quantizeOnce` воркера: RGBA сглаживается до квантования, `q.luminance` — после. UI-ползунок повторяет модель дизеринга (drag → scheduleReprocess, release → saveSettings). Настройка проходит через localStorage, undo-снапшоты и `.hueforge.json` как опциональное поле.

**Tech Stack:** TypeScript, Vitest, Web Worker (существующий), без новых npm-зависимостей.

**Spec:** `docs/superpowers/specs/2026-09-21-smooth-relief-clean-fills-design.md`

## Global Constraints

- Никаких новых npm-зависимостей.
- Тексты интерфейса — только через `src/i18n.ts`, всегда RU+EN (тест `i18n.test.ts` следит за парностью).
- Комментарии в коде — на английском (стиль существующего кода), документация — на русском.
- `strength = 0` (ползунок 0%) — поведение байт-в-байт как сейчас: фильтр возвращает вход без копирования.
- Каждый запуск проверки: `npm run typecheck`, затем `npx vitest run <файл>` для точечных тестов; перед коммитом — `npm test`.
- Сообщения коммитов: conventional-commit с русским описанием после префикса.
- Файлы `.bat` не трогаем; `index.html` правим только в секции «Цвета».

---

### Task 1: Модуль `src/lib/smooth.ts` — два bilateral-фильтра

**Files:**
- Create: `src/lib/smooth.ts`
- Test: `src/test/smooth.test.ts`

**Interfaces:**
- Consumes: ничего (только `src/lib/types.ts` при необходимости).
- Produces (используют Task 2 и Task 3):
  - `bilateralSmoothRGBA(rgba: Uint8ClampedArray, width: number, height: number, strength: number): Uint8ClampedArray` — возвращает НОВЫЙ массив; при `strength <= 0` возвращает тот же объект `rgba` (без копии).
  - `smoothScalarField(t: Float32Array, width: number, height: number, strength: number): Float32Array` — те же гарантии для скалярного поля 0..1.

- [ ] **Step 1: Написать падающие тесты**

Создать `src/test/smooth.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { bilateralSmoothRGBA, smoothScalarField } from '../lib/smooth'

const W = 16
const H = 16

function solidRGB(r: number, g: number, b: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) a.set([r, g, b, 255], i * 4)
  return a
}

function verticalEdge(): Uint8ClampedArray {
  const a = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) a.set([x < W / 2 ? 20 : 230, x < W / 2 ? 20 : 230, x < W / 2 ? 20 : 230, 255], (y * W + x) * 4)
  return a
}

describe('bilateralSmoothRGBA', () => {
  it('strength 0 возвращает тот же буфер без изменений', () => {
    const src = verticalEdge()
    expect(bilateralSmoothRGBA(src, W, H, 0)).toBe(src)
  })

  it('плоское поле не меняется', () => {
    const src = solidRGB(90, 120, 200)
    const out = bilateralSmoothRGBA(src, W, H, 0.5)
    expect(Array.from(out)).toEqual(Array.from(src))
  })

  it('резкая граница сохраняется: ступень не размывается в градиент шире 2 клеток', () => {
    const src = verticalEdge()
    const out = bilateralSmoothRGBA(src, W, H, 0.8)
    const lum = (x: number, y = 8) => {
      const i = (y * W + x) * 4
      return 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]
    }
    // Ширина перехода: число столбцов между 25% и 75% ступени.
    const width = (arr: Uint8ClampedArray) => {
      let lo = 0
      let hi = W - 1
      const l = (x: number) => {
        const i = (8 * W + x) * 4
        return 0.299 * arr[i] + 0.587 * arr[i + 1] + 0.114 * arr[i + 2]
      }
      while (lo < W && l(lo) > 80) lo++
      while (hi >= 0 && l(hi) < 170) hi--
      return hi - lo
    }
    expect(width(out)).toBeLessThanOrEqual(width(src) + 2)
    // Ступень реально существует (не слиплась в середину).
    expect(lum(1)).toBeLessThan(60)
    expect(lum(W - 2)).toBeGreaterThan(190)
  })

  it('шум на рампе успокаивается, средний уровень сохраняется', () => {
    const src = new Uint8ClampedArray(W * H * 4)
    let seed = 42
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 60
    for (let i = 0; i < W * H; i++) {
      const v = Math.round((i / (W * H)) * 200 + 28 + rnd())
      src.set([v, v, v, 255], i * 4)
    }
    const out = bilateralSmoothRGBA(src, W, H, 0.6)
    const dev = (a: Uint8ClampedArray) => {
      let s = 0
      for (let i = 0; i < W * H; i++) {
        const v = a[i * 4]
        const ideal = 28 + (i / (W * H)) * 200
        s += Math.abs(v - ideal)
      }
      return s / (W * H)
    }
    expect(dev(out)).toBeLessThan(dev(src) * 0.6)
  })

  it('альфа не трогается', () => {
    const src = solidRGB(10, 10, 10)
    for (let i = 0; i < W * H; i++) src[i * 4 + 3] = 7
    const out = bilateralSmoothRGBA(src, W, H, 0.9)
    for (let i = 0; i < W * H; i++) expect(out[i * 4 + 3]).toBe(7)
  })
})

describe('smoothScalarField', () => {
  it('strength 0 возвращает то же поле', () => {
    const f = new Float32Array(W * H).fill(0.4)
    expect(smoothScalarField(f, W, H, 0)).toBe(f)
  })

  it('плато не размывается', () => {
    const f = new Float32Array(W * H).fill(0.5)
    const out = smoothScalarField(f, W, H, 0.7)
    expect(Array.from(out)).toEqual(Array.from(f))
  })

  it('одиночный пик убирается, соседи почти не тронуты', () => {
    const f = new Float32Array(W * H).fill(0.4)
    f[8 * W + 8] = 1.0
    const out = smoothScalarField(f, W, H, 0.7)
    expect(out[8 * W + 8]).toBeLessThan(0.7)
    expect(out[3 * W + 3]).toBeCloseTo(0.4, 5)
  })

  it('резкая терраса сохраняется', () => {
    const f = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = x < W / 2 ? 0.1 : 0.9
    const out = smoothScalarField(f, W, H, 0.8)
    expect(out[8 * W + 1]).toBeLessThan(0.25)
    expect(out[8 * W + W - 2]).toBeGreaterThan(0.75)
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/test/smooth.test.ts`
Expected: FAIL — модуль `../lib/smooth` не найден.

- [ ] **Step 3: Реализовать модуль**

Создать `src/lib/smooth.ts`:

```ts
/**
 * Edge-preserving smoothing (bilateral filter) for the pipeline's two
 * smoothing points: the RGBA image before quantization (clean fills) and the
 * per-pixel relief field (no more pixel-noise "himalayas"). A bilateral
 * filter averages neighbours but weights them by brightness similarity, so
 * flat areas and gradients flatten out while sharp edges keep their step.
 *
 * Pure module — no DOM, no worker globals — directly unit-testable in Node.
 *
 * Strength is a single 0..1 number: 0 returns the input untouched (identity,
 * zero cost), higher values grow the kernel radius (1..3 cells) and blend the
 * filtered result with the original. The edge threshold (what counts as a
 * "border") differs per domain and is fixed inside — callers only see one knob.
 */

/** Kernel radius in cells for a strength value (0 → 0, 1 → 3). */
function radiusOf(strength: number): number {
  if (!(strength > 0)) return 0
  return Math.min(3, Math.max(1, Math.round(strength * 3)))
}

/** Cached exp weights for a window: spatial part (same for every pixel). */
function spatialWeights(r: number): Float32Array {
  const size = 2 * r + 1
  const w = new Float32Array(size * size)
  const sigma = r / 1.5
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) w[(dy + r) * size + (dx + r)] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
  return w
}

const LUMA_R = 0.299
const LUMA_G = 0.587
const LUMA_B = 0.114
/** Range sigma for RGBA: luminance distance in 0..255 that still counts as "same surface". */
const SIGMA_RGBA = 60
/** Range sigma for the scalar relief field (0..1 domain). */
const SIGMA_SCALAR = 0.15

export function bilateralSmoothRGBA(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  strength: number,
): Uint8ClampedArray {
  const r = radiusOf(strength)
  if (r === 0 || width < 1 || height < 1) return rgba
  const out = new Uint8ClampedArray(rgba.length)
  const size = 2 * r + 1
  const spatial = spatialWeights(r)
  const twoSigma2 = 2 * SIGMA_RGBA * SIGMA_RGBA
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const p = idx * 4
      const cr = rgba[p]
      const cg = rgba[p + 1]
      const cb = rgba[p + 2]
      const centerLum = LUMA_R * cr + LUMA_G * cg + LUMA_B * cb
      let wSum = 0
      let accR = 0
      let accG = 0
      let accB = 0
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy))
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx))
          const q = (yy * width + xx) * 4
          const qr = rgba[q]
          const qg = rgba[q + 1]
          const qb = rgba[q + 2]
          const lum = LUMA_R * qr + LUMA_G * qg + LUMA_B * qb
          const dl = lum - centerLum
          const w = spatial[(dy + r) * size + (dx + r)] * Math.exp(-(dl * dl) / twoSigma2)
          wSum += w
          accR += w * qr
          accG += w * qg
          accB += w * qb
        }
      }
      const k = Math.min(1, strength)
      out[p] = cr + (accR / wSum - cr) * k
      out[p + 1] = cg + (accG / wSum - cg) * k
      out[p + 2] = cb + (accB / wSum - cb) * k
      out[p + 3] = rgba[p + 3]
    }
  }
  return out
}

export function smoothScalarField(
  t: Float32Array,
  width: number,
  height: number,
  strength: number,
): Float32Array {
  const r = radiusOf(strength)
  if (r === 0 || width < 1 || height < 1) return t
  const out = new Float32Array(t.length)
  const size = 2 * r + 1
  const spatial = spatialWeights(r)
  const twoSigma2 = 2 * SIGMA_SCALAR * SIGMA_SCALAR
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const center = t[idx]
      let wSum = 0
      let acc = 0
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy))
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx))
          const v = t[yy * width + xx]
          const d = v - center
          const w = spatial[(dy + r) * size + (dx + r)] * Math.exp(-(d * d) / twoSigma2)
          wSum += w
          acc += w * v
        }
      }
      const k = Math.min(1, strength)
      out[idx] = center + (acc / wSum - center) * k
    }
  }
  return out
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run src/test/smooth.test.ts`
Expected: PASS (9 тестов).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/smooth.ts src/test/smooth.test.ts
git commit -m "feat(smooth): bilateral-фильтры для заливок и рельефа"
```

---

### Task 2: Врезка в пайплайн — `PipelineOptions.smooth` + `quantizeOnce`

**Files:**
- Modify: `src/lib/pipeline.ts` (интерфейс `PipelineOptions`, ~строка 35)
- Modify: `src/lib/workerProtocol.ts` (функция `quantizeOnce` и её вызовы, ~строки 180–230, 247)
- Test: `src/test/workerProtocol.test.ts` (добавить describe)
- Test: `src/test/pipeline.test.ts` (добавить тест энергии градиентов)

**Interfaces:**
- Consumes: `bilateralSmoothRGBA`, `smoothScalarField` из Task 1.
- Produces: `PipelineOptions.smooth?: number` (0..1, default 0). Воркер применяет оба сглаживания; `smooth = 0`/`undefined` — путь байт-в-байт прежний. Task 4 (UI) заполняет это поле через `readOptions()`.

- [ ] **Step 1: Написать падающие тесты**

В `src/test/workerProtocol.test.ts` добавить (в конец файла, тот же стиль, что существующие describe — используются хелперы файла: `quantizeTask`, `opts`, `C`, `resetWorkerState`, `runWorkerTask`; сверьтесь с фактическими именами в файле перед вставкой):

```ts
describe('relief smoothing (opts.smooth)', () => {
  it('smooth=0 байт-в-байт равен запуску без поля', async () => {
    resetWorkerState()
    const rgba = noisyRgba(32, 32) // хелпер файла с шумными пикселями; если нет — сгенерировать локально
    const off = await runWorkerTask(quantizeTask({ id: 1, rgba: rgba.slice(), width: 32, height: 32, opts: opts({ smooth: 0 }) }))
    resetWorkerState()
    const missing = await runWorkerTask(quantizeTask({ id: 2, rgba: rgba.slice(), width: 32, height: 32, opts: opts({}) }))
    expect(Array.from(off.quantized.indexMap)).toEqual(Array.from(missing.quantized.indexMap))
    expect(Array.from(off.quantized.luminance)).toEqual(Array.from(missing.quantized.luminance))
    expect(off.quantized.palette).toEqual(missing.quantized.palette)
  })

  it('smooth>0 делает рельеф глаже (меньше энергия лапласиана) и меняет палитру зашумлённой картинки', async () => {
    resetWorkerState()
    const rgba = noisyRgba(32, 32)
    const raw = await runWorkerTask(quantizeTask({ id: 3, rgba: rgba.slice(), width: 32, height: 32, opts: opts({}) }))
    resetWorkerState()
    const smoothed = await runWorkerTask(quantizeTask({ id: 4, rgba: rgba.slice(), width: 32, height: 32, opts: opts({ smooth: 0.6 }) }))
    const laplacian = (lum: Float32Array, w: number, h: number) => {
      let s = 0
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          s += Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w])
        }
      return s
    }
    expect(laplacian(smoothed.quantized.luminance, 32, 32)).toBeLessThan(laplacian(raw.quantized.luminance, 32, 32) * 0.8)
    expect(smoothed.quantized.palette).not.toEqual(raw.quantized.palette)
  })
})
```

Если хелпера `noisyRgba` в файле нет — добавить локально в describe:

```ts
function noisyRgba(w: number, h: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4)
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 80
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(128 + rnd())
    a.set([v, v, v, 255], i * 4)
  }
  return a
}
```

В `src/test/pipeline.test.ts` добавить:

```ts
it('сглаженное поле рельефа имеет меньшую энергию градиентов', () => {
  const w = 24
  const h = 24
  const q = quantizedFixture()
  // Заменяем luminance шумной рампой и её же сглаженной версией.
  const noisy = new Float32Array(w * h)
  let seed = 3
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 0.3
  for (let i = 0; i < w * h; i++) noisy[i] = Math.min(1, Math.max(0, 0.5 + rnd()))
  const energy = (values: Float32Array) => {
    let s = 0
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        s += Math.abs(4 * values[i] - values[i - 1] - values[i + 1] - values[i - w] - values[i + w])
      }
    return s
  }
  const build = (lum: Float32Array) => {
    const image = { ...q, width: w, height: h, luminance: lum }
    return buildHeightField(image, settings()).values
  }
  expect(energy(build(smoothScalarField(noisy, w, h, 0.7)))).toBeLessThan(energy(build(noisy)))
})
```

(импорты `smoothScalarField` из `../lib/smooth` и `buildHeightField` из `../lib/heightmap` добавить в шапку теста; `quantizedFixture`/`settings` — существующие хелперы файла.)

- [ ] **Step 2: Убедиться, что новые тесты падают**

Run: `npx vitest run src/test/workerProtocol.test.ts src/test/pipeline.test.ts`
Expected: FAIL — `opts({ smooth: ... })` не влияет (поле игнорируется) / `smoothScalarField` не импортирован.

- [ ] **Step 3: Реализовать**

3.1. В `src/lib/pipeline.ts` в `PipelineOptions` после `bandHeightsMm` добавить:

```ts
  /**
   * Edge-preserving smoothing strength 0..1 (0 = off, the default). Applied
   * twice inside the worker's quantize step: RGBA before quantization (clean
   * fills) and the luminance/relief field after (no per-pixel spikes).
   */
  smooth?: number
```

3.2. В `src/lib/workerProtocol.ts` добавить импорт и хелпер + врезку в `quantizeOnce`:

```ts
import { bilateralSmoothRGBA, smoothScalarField } from './smooth'
```

В начале `quantizeOnce` (до ветки nearest/луминансных полос):

```ts
  const smooth = Number.isFinite(opts.smooth) ? Math.min(1, Math.max(0, opts.smooth!)) : 0
  const source = smooth > 0 && width > 1 && height > 1 ? bilateralSmoothRGBA(rgba, width, height, smooth) : rgba
```

и заменить все использования `rgba` внутри `quantizeOnce` на `source` (в вызовах `quantizeToPalette` и `mapToLuminanceBands`). После получения `q` (после ветки if/else, до посева customHeights) добавить:

```ts
  // Relief smoothing: the stored luminance is the height map's input; smoothing
  // it here means previews, mesh, exports and printability all share one
  // smoothed field. Color assignment above stays untouched.
  if (smooth > 0 && q.luminance.length === width * height) {
    q.luminance = smoothScalarField(q.luminance, width, height, smooth)
  }
```

3.3. В `runFitToneTask` (тот же файл) захостить RGBA-сглаживание — один раз до поиска:

```ts
  const smooth = Number.isFinite(task.opts.smooth) ? Math.min(1, Math.max(0, task.opts.smooth!)) : 0
  const source =
    smooth > 0 && task.width > 1 && task.height > 1 ? bilateralSmoothRGBA(task.rgba, task.width, task.height, smooth) : task.rgba
```

и в кандидатном колбэке заменить `quantizeOnce(task.rgba, ...)` на `quantizeOnce(source, task.width, task.height, { ...opts, smooth: 0 }, null, opts.mergeDeltaE)` — scalar-сглаживание остаётся включённым внутри `quantizeOnce` (оно входит в метрики рельефа), а RGBA не повторяется на каждом кандидате. Внимание: `q.luminance` у кандидата сглаживается, как и в финальном прогоне — метрики честные.

3.4. Экспорт `smooth` наружу из `snapshot()` не нужен: `luminance` уже копируется.

- [ ] **Step 4: Убедиться, что тесты проходят и регресса нет**

Run: `npx vitest run src/test/workerProtocol.test.ts src/test/pipeline.test.ts src/test/toneFit.test.ts src/test/bandMergeWorker.test.ts`
Expected: PASS — включая новые. `smooth=0` тест гарантирует отсутствие регрессии в существующих сценариях.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/pipeline.ts src/lib/workerProtocol.ts src/test/workerProtocol.test.ts src/test/pipeline.test.ts
git commit -m "feat(smooth): врезка bilateral-сглаживания в quantize воркера"
```

---

### Task 3: UI — ползунок «Сглаживание», i18n, localStorage

**Files:**
- Modify: `index.html` (блок после подсказки дизеринга, ~строка 153–154)
- Modify: `src/i18n.ts` (рядом с `ditherLabel`/`ditherHint`/`helpDither`, ~строки 255–310)
- Modify: `src/ui/main.ts` (константы ~114, `Settings` ~216, `saveSettings` ~237, `restoreSettings` ~275, `readOptions` ~330, слушатели рядом с дизерингом ~3162)

**Interfaces:**
- Consumes: `PipelineOptions.smooth` из Task 2.
- Produces: `readOptions().smooth` (0..1) заполнен из ползунка; localStorage-ключ `hf-settings` несёт `smooth` (проценты 0..100).

- [ ] **Step 1: HTML — слайдер**

В `index.html` после строки `<p class="muted small slider-hint" data-i18n="ditherHint">…</p>` (~154) вставить:

```html
            <div class="slider-row dither-row">
              <span class="slider-label" data-i18n="smoothLabel">Smoothing</span>
              <div class="slider-main">
                <input id="smooth-slider" type="range" min="0" max="100" step="5" value="30" aria-label="Smoothing strength" data-help="helpSmooth" />
              </div>
              <span id="smooth-value" class="dither-value muted small">30%</span>
            </div>
            <p class="muted small slider-hint" data-i18n="smoothHint">Smoothing flattens photo noise before colors and heights are built — no more rough «himalaya» surfaces, gradients become clean fills. Edges stay sharp. 0 = off.</p>
```

- [ ] **Step 2: i18n — RU/EN строки**

В `src/i18n.ts` рядом с `ditherLabel` (~255) добавить:

```ts
  smoothLabel: { en: 'Smoothing', ru: 'Сглаживание' },
  smoothHint: {
    en: 'Smoothing flattens photo noise before colors and heights are built — no more rough «himalaya» surfaces, gradients become clean fills. Edges stay sharp. 0 = off.',
    ru: 'Сглаживание убирает фотографический шум до построения цветов и высот — поверхность без «гималаев», градиенты превращаются в чистые заливки. Границы остаются резкими. 0 = выкл.',
  },
```

И рядом с `helpDither` (~308):

```ts
  helpSmooth: {
    en: 'Bilateral smoothing: flattens noise and fine texture while keeping sharp edges. Applied twice — to the colors before quantization (clean fills instead of muddy mixes) and to the relief map (smooth surface instead of per-pixel spikes). Higher = flatter; photo prints usually want 30–60%.',
    ru: 'Двустороннее сглаживание: убирает шум и мелкую фактуру, сохраняя резкие границы. Применяется дважды — к цветам перед квантованием (чистые заливки вместо грязных смесей) и к карте рельефа (гладкая поверхность вместо попиксельных пиков). Больше — ровнее; фотографиям обычно хорошо 30–60%.',
  },
```

- [ ] **Step 3: main.ts — константы, readOptions, слушатели, настройки**

3.1. Рядом с `ditherSlider` (~114):

```ts
const smoothSlider = $<HTMLInputElement>('#smooth-slider')
const smoothValue = $<HTMLSpanElement>('#smooth-value')
```

3.2. В типе `Settings` (~216) после `dither: number`:

```ts
  /** Edge-preserving smoothing in percent (0 = off, default 30). */
  smooth: number
```

3.3. В `saveSettings()` (~247) после `dither: …`:

```ts
      smooth: clampNum(Number(smoothSlider.value), 0, 100, 30),
```

3.4. В `restoreSettings()` (~275) после строки `ditherSlider.value = …`:

```ts
    if (s.smooth !== undefined) {
      smoothSlider.value = String(clampNum(Number(s.smooth), 0, 100, 30))
      smoothValue.textContent = `${smoothSlider.value}%`
    }
```

3.5. В `readOptions()` (~330) после `dither`:

```ts
    smooth: clampNum(Number(smoothSlider.value), 0, 100, 30) / 100,
```

3.6. Слушатели — в `bindInputs()` рядом с блоком дизеринга (~3162):

```ts
  // Smoothing: debounced live reprocess on drag, flushed on release —
  // same lifecycle as dithering (it lives in the quantize step too).
  smoothSlider.addEventListener('input', () => {
    smoothValue.textContent = `${smoothSlider.value}%`
    scheduleReprocess()
  })
  smoothSlider.addEventListener('change', () => {
    flushReprocess()
    saveSettings()
  })
```

- [ ] **Step 4: Проверка**

Run: `npm run typecheck && npx vitest run src/test/i18n.test.ts src/test/help.test.ts`
Expected: PASS — парность i18n и data-help целы.

Затем руками в dev-режиме (`npm run dev`): загрузить фотографию, поднять ползунок до 60% — шум в превью уходит, контуры остаются; 0% — картинка как раньше.

- [ ] **Step 5: Коммит**

```bash
git add index.html src/i18n.ts src/ui/main.ts
git commit -m "feat(smooth): ползунок сглаживания в секции цветов"
```

---

### Task 4: Проект (.hueforge.json) и undo — поле `smooth`

**Files:**
- Modify: `src/lib/project.ts` (`ProjectSettings`, ~строка 42)
- Modify: `src/ui/main.ts` — `captureSnapshot` (~1658), `saveProject` (~4134), `applyProjectSettings` (~4158)
- Test: `src/test/project.test.ts` (добавить кейсы)

**Interfaces:**
- Consumes: `smoothSlider` из Task 3, `opts.smooth` из Task 2.
- Produces: `ProjectSettings.smooth?: number` (проценты 0..100; отсутствие = старый файл, применяется 0… нет: применяется слайдер по умолчанию 30? — см. Step 1: у проекта отсутствие поля означает «не указано», применяется 0 — старые проекты открываются как раньше).

- [ ] **Step 1: Написать падающие тесты**

В `src/test/project.test.ts` в список `sample()`-проектов и проверок добавить:

```ts
it('round-trips smooth strength and defaults old files to 0', () => {
  const withSmooth = sample()
  withSmooth.settings.smooth = 45
  const parsed = parseProjectFile(JSON.stringify(buildProjectFile({ ...withSmooth, imageName: 'a.png', dataUrl: 'data:image/png;base64,AA' })))
  expect(parsed.settings.smooth).toBe(45)

  const old = sample()
  delete (old.settings as Partial<typeof old.settings>).smooth
  const parsedOld = parseProjectFile(JSON.stringify(buildProjectFile({ ...old, imageName: 'a.png', dataUrl: 'data:image/png;base64,AA' })))
  expect(parsedOld.settings.smooth).toBeUndefined()
})
```

(сверить с фактическим API `sample()`/`buildProjectFile` в файле теста и подогнать вызовы.)

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/test/project.test.ts`
Expected: FAIL — поле `smooth` не попадает в файл (или падение типов).

- [ ] **Step 3: Реализовать**

3.1. В `ProjectSettings` (`src/lib/project.ts`) после `mergeDeltaE?`:

```ts
  /** Edge-preserving smoothing (percent, 0 = off); absent = not specified (old projects). */
  smooth?: number
```

3.2. `captureSnapshot()` (`src/ui/main.ts` ~1658) после `dither: …`:

```ts
    smooth: Math.round(opts.smooth * 100),
```

(`snapshotsEqual` сравнивает JSON — новое поле попадает автоматически, undo начнёт отслеживать сглаживание без правок.)

3.3. `saveProject()` (~4134) после `dither: …`:

```ts
        smooth: Math.round(opts.smooth * 100),
```

3.4. `applyProjectSettings()` (~4158) после строки `ditherValue.textContent = …`:

```ts
  if (s.smooth !== undefined) {
    smoothSlider.value = String(clamp(s.smooth, 0, 100, 30))
    smoothValue.textContent = `${smoothSlider.value}%`
  }
```

Старые проекты (без поля) оставляют текущее значение ползунка — ровно «открылись как раньше».

- [ ] **Step 4: Проверка**

Run: `npx vitest run src/test/project.test.ts src/test/customTones.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/project.ts src/ui/main.ts src/test/project.test.ts
git commit -m "feat(smooth): поле сглаживания в проекте и undo-снапшотах"
```

---

### Task 5: Регресс, счётчики README, финальная сборка

**Files:**
- Modify: `README.md` (строка со счётчиком тестов, ~«npm test # 381 теста (38 файлов с тестами)»)

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: зелёная полная проверка; обновлённые счётчики.

- [ ] **Step 1: Полная проверка**

Run: `npm test && npm run typecheck && npm run build`
Expected: все тесты зелёные (записать новые количества файлов/тестов из вывода `Test Files X passed`, `Tests Y passed`), сборка успешна.

- [ ] **Step 2: Обновить счётчики в README**

В `README.md` заменить строку `npm test        # 381 тест (38 файлов с тестами)` на фактические числа из Step 1 (формат строки сохранить).

- [ ] **Step 3: Ручная smoke-проверка в dev**

`npm run dev`: загрузить детализированную фотографию → 0% (старое поведение: шершаво) → 30% (гладко, контуры на месте) → 70% (плоско, но чисто). Сохранить/открыть `.hueforge.json` — сглаживание восстанавливается. Ctrl+Z после смены ползунка возвращает прежнее значение.

- [ ] **Step 4: Коммит**

```bash
git add README.md
git commit -m "docs(readme): счётчики тестов после сглаживания"
```

---

## Само-проверка плана (выполнена при написании)

- **Покрытие спеки:** модуль smooth.ts (Task 1), обе точки врезки + воркер (Task 2), тон-fit-хостинг (Task 2 Step 3.3), UI+дефолт 30%+localStorage (Task 3), проект+undo (Task 4), тесты из секции 4 спеки распределены по Tasks 1–2, README-счётчики (Task 5).
- **Плейсхолдеров нет:** каждый шаг содержит код; в местах, зависящих от фактических хелперов тестов (`sample()`, `opts()`, `noisyRgba`), дана явная инструкция свериться с файлом — это не «TBD», а привязка к существующему коду.
- **Типы согласованы:** `smooth` в `PipelineOptions` — доли 0..1; в `Settings`/`ProjectSettings` — проценты 0..100; конверсия только в `readOptions` (`/100`) и `captureSnapshot`/`saveProject` (`Math.round(*100)`).
- **Порядок:** Tasks 1→2 можно мержить независимо от 3→4; Task 5 финальный.
