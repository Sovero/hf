# Что уже построено

Читается каждым исполнителем до начала работы. Не изобретай заново то, что здесь есть.

## Общие правила проекта

- Стек: Vite + TypeScript + Vitest, клиентское приложение; настольная версия — Electron (`electron-main.cjs`, `file://`).
- Команды: `npm run typecheck`, `npm test`, `npm run build`.
- Документация и сообщения коммитов — на русском (см. `AGENTS.md`); тексты интерфейса — в `src/i18n.ts` (en + ru, паритет ключей проверяется тестом).
- Импортированные данные не вставляются в `innerHTML` — только `textContent`.
- Без сети: CSP `connect-src 'self'` не расширять.

## Доменные контракты (существующие)

- `QuantizedImage.luminance` — «позиция рельефа» 0..1 (0 = основание, 1 = самое высокое), на неё опираются `buildHeightField`, превью и печатаемость.
- `mapToLuminanceBands(rgba, numColors, width, height, darkIsTall, dither, tone, colorSource, minBandFrac)` в `src/lib/quantize.ts` строит `x` (позиция рельефа) из яркости; дальше — чистка пятен, полосы по рангу, палитра = средний цвет полосы.
- `QuantizeTask` (`src/lib/workerProtocol.ts`) — задача воркера пайплайна; `quantizeOnce` выбирает режим по `opts.colorMode`.
- Палитра в яркостном режиме отсортирована тёмный → светлый и совпадает с индексом полосы; `PaletteEntry.printOrder` считается от `darkIsTall`.

## Договорённости новой фичи

- Тип `DepthMap` — `{ width, height, data: Float32Array }`, значения 0..1, **ближе = больше**.
- Источник рельефа — `ReliefSource = 'luma' | 'depth' | 'file'`; по умолчанию `'luma'`.
- Модель: `src/assets/depth-anything-v2-small/model_quantized.onnx` (Apache-2.0); вход `pixel_values` `[1,3,H,W]`, выход `predicted_depth` `[1,H,W]`.
- Изменения коммитятся в ветку сессии (`claude/clever-goodall-526njx`) по указанию окружения; правило «не коммитить» прошлой фичи к этой сессии не относится.

## Тикет 01 — Движок глубины

- `src/lib/depth/depthMap.ts`: `DepthMap`, `normalizeDepth` (2–98 перцентили, `flat` при вырожденном диапазоне), `resampleDepth` (билинейно), `depthToRelief(map, w, h, invert)` (всегда новый массив).
- `src/lib/depth/preprocess.ts`: `modelInputSize` (длинная сторона 518, кратно 14), `rgbaToModelInput` (CHW, ImageNet, площадное усреднение при уменьшении).
- `src/lib/depth/estimator.ts`: `createDepthEstimator({ model, wasm })` → `DepthEstimator.estimate(rgba, w, h)`; ORT: один поток, `wasmBinary` из байтов, без обращений к сети.
- `src/lib/depth/protocol.ts` + `src/worker/depth.worker.ts` + `src/ui/depthClient.ts`: `estimateDepth(rgba, w, h, onPhase)`, очередь запросов, `DepthError.code`.
- `src/ui/depthResources.ts`: `fetch` модели и wasm (Vite `?url`).
- Тесты: `depthMap`, `depthPreprocess`, `depthEngine` (реальная модель, ~8 с), `csp`.

## Тикет 02 — Рельеф по глубине в пайплайне

- `mapToLuminanceBands(..., minBandFrac, reliefField?)`: поле 0..1 вместо яркости; `darkIsTall` игнорируется; индекс палитры = слой высоты (не отсортирована по яркости); без поля результат побайтно прежний.
- `QuantizeTask.reliefField` / `FitToneTask.reliefField`; воркер помнит `reliefActive` и принудительно ставит `darkIsTall=false` и для `quantize`, и для последующих `finish`. Вместе с каталогом (`nearestPalette`) — ошибка.
- `ReliefSource = 'luma' | 'depth' | 'file'` (`types.ts`); `ProjectSettings.reliefSource?/invertDepth?` с валидацией.
- Тесты: `depthRelief` (15), `project` (+1), `lumaGolden` (хеши яркостного пути, сверены с `HEAD` на 256 комбинациях).

## Тикет 03 — Интерфейс

- `index.html`: группа «Источник рельефа» (`input[name="relief-source"]`), `#depth-extra` / `#depth-invert`, `#depth-status`, ид `#polarity-options`.
- `src/ui/depthRelief.ts`: кэш глубины по `File`, общий запрос для одного файла, `depthErrorKey/Detail`.
- `src/ui/main.ts`: `readReliefSource` / `setReliefSource` / `syncReliefUi` / `reliefFieldFor` (при сбое — откат на яркость + сообщение); поле передаётся во все `quantizeInWorker` и в подгонку тона; каталог и глубина взаимоисключают друг друга; сохранение в настройках, проекте и снимках отмены.
- `i18n.ts`: `reliefSource*`, `depth*` (RU/EN).
