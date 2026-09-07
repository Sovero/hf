# Спека: Импорт и анализ reference 3MF

## Задача

Пользователь хочет открыть готовый HueForge/Bambu 3MF, понять, какие цвета, размеры, высоты и смены филамента в нём заложены, и при необходимости применить распознанные настройки к текущему изображению. Сейчас приложение умеет экспортировать 3MF, но не объясняет чужой reference-файл и не даёт использовать его как шаблон.

## Решение

В приложение добавляется отдельная зона загрузки `.3mf`. После выбора файл разбирается локально в браузере и показывает отчёт: имя/размер файла, объекты и mesh bounds, количество треугольников, найденные цвета и порядок печати, высоты band boundaries, layer height и список смен инструмента. Отчёт явно разделяет распознанные, отсутствующие и частично распознанные поля.

Анализ не меняет текущую картинку и текущие настройки. Если найден полный совместимый набор данных, появляется кнопка «Apply to editor». Она переносит распознанные цвета, layer height, размеры, base/max height и swap schedule, затем повторно строит текущую картинку. Картинка пользователя не заменяется reference-моделью. При недостатке данных кнопка отключена с объяснением, но частичный отчёт остаётся доступен.

## Пользовательские истории

| # | Метка | История | Приёмка |
|---|---|---|---|
| 1 | R01 | Как пользователь, я загружаю reference 3MF и вижу, что в нём находится | Есть отдельный 3MF input/dropzone; после успешного разбора отображаются mesh bounds, triangle count, metadata и статус полноты анализа. |
| 2 | R01.1 | Как пользователь, я вижу цвета и порядок печати reference-файла | Палитра отображается bottom-to-top с hex, приблизительным именем филамента, print order и источником данных. |
| 3 | R01.2 | Как пользователь, я вижу план смены филамента | Каждая найденная смена показывает top_z в мм, номер слоя если layer height известен, extruder и цвет; список отсортирован по высоте. |
| 4 | R01.3 | Как пользователь, я понимаю, что файл распознан не полностью | Отсутствующие optional metadata помечаются как «not found», а не превращаются в выдуманные значения; partial report всё равно рендерится. |
| 5 | R02i | Как пользователь, я выбираю локальный `.3mf` так же, как исходное изображение | Поддерживаются click-to-browse и drag-and-drop; текущая image-загрузка продолжает работать отдельно. |
| 6 | R03i/G02 | Как пользователь, я открываю HueForge/Bambu-style или экспорт приложения | Парсер читает ZIP package, стандартный `3D/3dmodel.model`, Bambu/HueForge custom per-layer XML, filament settings и metadata приложения; неизвестные package parts игнорируются безопасно. |
| 7 | R04i | Как пользователь, я получаю понятную ошибку для повреждённого файла | Невалидный ZIP, отсутствующий model part, невалидный XML, неподдерживаемая единица или превышение лимита дают локализованную ошибку; текущий проект не очищается. |
| 8 | R05i/G01/G03 | Как пользователь, я сначала смотрю reference, а затем явно применяю его настройки к текущей картинке | До клика Apply текущий editor неизменен. Apply переносит все найденные представимые поля: palette, layer height, width/height, base/max height, band tops/swap schedule; отсутствующие поля остаются без изменения и перечисляются. |
| 9 | R06i | Как пользователь, я не замораживаю браузер большим файлом | До распаковки файл ограничен 100 MB; XML/metadata parts ограничены по размеру после распаковки; превышение останавливает анализ с объяснением. |
| 10 | R07i | Как владелец приложения, я не ломаю существующий image → STL/3MF workflow | Existing tests, typecheck и production build проходят; анализ reference не изменяет обычный экспорт без Apply. |

## Решения по реализации

### Архитектура

Сохраняется client-only Vite/TypeScript приложение:

```text
3MF File/Dropzone
        │ ArrayBuffer
        ▼
Reference 3MF parser ── ZIP (fflate) ── XML (DOMParser)
        │ Reference3mfAnalysis
        ├──────────────► Analysis panel
        └──────────────► Explicit Apply adapter ──► existing pipeline ──► previews/exports
```

- **Parser boundary:** отдельный модуль `reference3mf` принимает `File`/bytes и возвращает типизированный `Reference3mfAnalysis` либо локализуемую typed error. Причина: parser можно тестировать без DOM UI и не смешивать импорт с генерацией.
- **Package reader:** используется уже установленный `fflate`; не добавляется новая библиотека. Читаются только известные entries, остальные игнорируются.
- **XML:** `DOMParser` с namespace-agnostic local-name queries. XML не вставляется в `innerHTML`; все отображаемые значения проходят через `textContent`.
- **UI adapter:** `main.ts` владеет выбранным reference analysis и вызывает parser; `index.html` получает отдельную panel/dropzone; `i18n.ts` содержит en/ru copy; styles reuse existing panel/check-row/palette conventions.
- **Apply adapter:** преобразует report в существующие controls и pipeline data. Reference image/mesh не становится текущим изображением.

### Анализ данных

`Reference3mfAnalysis` содержит:

- `fileName`, `fileSizeBytes`, `status: complete | partial`;
- `model`: object count, triangle count, unit, min/max XYZ, footprint width/height, max Z;
- `palette`: color, hex, print order, source (`app-metadata`, `custom-gcode`, `filament-settings`);
- `swaps`: `topZMm`, optional rounded layer, extruder, optional color;
- `settings`: optional width/height, base/max height, layer height, depth mode;
- `missingFields` and human-readable parser warnings;
- `canApply` plus `applyBlockedReason`.

Metadata precedence is deterministic: app metadata first, then explicit custom-gcode/filament settings, then mesh-derived dimensions/max Z. A missing field is never inferred from an unrelated value. App exports should include enough metadata for future round trips; external Bambu/HueForge files may produce a partial report.

Model units are converted to mm for display. A single printable model is required for Apply; multiple model objects may still be analyzed, but Apply is disabled because the current editor represents one image/one mesh.

### Apply semantics

Apply is non-destructive until clicked. On click:

1. Validate `canApply` and ensure an image is loaded; otherwise show a localized blocking message.
2. Set representable controls: supported color count, width, height, base, max, layer height, depth mode.
3. Reprocess the current image with those controls.
4. Override the generated palette with the reference palette in the pipeline’s expected index/order representation.
5. Convert reference bottom-to-top swap boundaries to normalized `bandTops`; retain only valid ascending boundaries and let existing grid snapping preserve internal layer alignment while the final top uses max height.
6. Rebuild previews, 3D mesh, palette legend, printability report, and exports. Show which fields were applied and which were unavailable.

If the reference color count is not one of the app-supported counts (2/4/8/12/16/24), Apply is disabled rather than silently changing the schedule. Reference reports remain viewable.

### Failure and limits

- Empty state: the reference panel explains that a `.3mf` can be dropped or selected and remains hidden/compact until use.
- Bad extension or empty file: reject before unzip with a localized message.
- ZIP/XML/model failures: preserve the current image/editor and show a dismissible error status.
- Missing optional metadata: return partial report with per-field `not found` labels.
- Input limit: reject files over 100 MB before decompression; reject oversized known XML entries after decompression. No network or server is used.
- Repeated selection: each new reference replaces only the reference report; it never replaces the current image. Apply is explicit and idempotent for the same data.
- Large meshes: scan vertices/triangles once and keep only aggregate bounds/counts; do not render imported geometry in the existing viewer.

### Test seams

1. **`parseReference3mf(bytes/File)` public parser seam:** synthetic ZIP fixtures cover app metadata, Bambu custom-gcode, filament settings, model bounds/unit conversion, missing optional parts, invalid XML, multiple objects, and limits.
2. **`applyReference`/pipeline adapter seam:** fixture report + image verifies controls/settings/palette/band tops flow into the existing result without replacing the image.
3. **UI smoke seam:** existing build plus DOM-level tests or browser acceptance verifies empty, success, partial, error, and Apply states.

## Вне рамок

| Требование / желание | Почему не сейчас |
|---|---|
| R03i — поддержка любого экзотического 3MF vendor extension | Обязательная цель ограничена HueForge/Bambu-style и app exports; неизвестные parts получают partial report. |
| R01 — редактирование импортированной mesh геометрии | Brief asks analyze/import as reference, not mesh editing; existing editor remains image-driven. |
| R01 — восстановление исходной картинки из reference 3MF | A 3MF contains geometry/schedule, not a reliable source bitmap; Apply deliberately preserves the current image. |
| R06i — worker/off-main-thread parsing for arbitrarily huge archives | 100 MB/known-part limits keep the client flow bounded; workerization is a later performance project. |

## Открытые места

Нет placeholders: provider, account, credentials и внешние сервисы не нужны. Для external files без base/layer/depth metadata report marks those fields unavailable and Apply remains partial/disabled according to the validation rules.

## Покрытие манифеста

| Требование | Раздел спеки |
|---|---|
| R01 | Stories 1–4; Analysis data |
| R02i | Story 5; UI adapter |
| R03i | Story 6; Architecture / Package reader |
| R04i | Story 7; Failure and limits |
| R05i | Story 8; Apply semantics |
| R06i | Story 9; Failure and limits |
| R07i | Story 10; Test seams |
| G01 | Story 8; Apply semantics |
| G02 | Story 6; Analysis data |
| G03 | Story 8; Apply semantics |
