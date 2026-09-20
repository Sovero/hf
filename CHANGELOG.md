# Changelog

История версий HueForge Desktop: то же содержимое, что на страницах релизов
GitHub, но внутри репозитория — ноты версий читаются из кода вместе с историей,
а не живут только на сайте.

## Каналы

| Канал | Что это | Кто получает |
| --- | --- | --- |
| **Latest** | ровно один релиз; его отдаёт `releases/latest`, и его резолвит приложение (`allowPrerelease = false`) | все установки — автообновлением |
| **Pre-release** | кандидат (`vX.Y.Z-rc.N`), метку Latest не перехватывает | только вручную, со страницы релиза |
| **Черновик** | собран, но не опубликован | никто |

Правило: тег с дефисом (RC) обязан публиковаться как pre-release — иначе
`releases/latest` укажет на кандидата и стабильные установки получат его
автообновлением. Порядок сборки и публикации — в [DEPLOY.md](DEPLOY.md).

## Как добавить версию

1. Соберите и опубликуйте релиз на GitHub (`npm run dist` → `gh release create` / `gh release upload`).
2. Выполните `npm run changelog:sync` — список ниже перегенерируется из релизов.
3. Закоммитьте `CHANGELOG.md` вместе с бампом версии.

Раздел ниже генерируется из релизов GitHub: тела релизов переносятся дословно,
ссылками и разметкой. Править вручную нужно только этот заголовок — иначе
правки затрёт следующая синхронизация.

<!-- releases:start -->

| Версия | Дата | Канал |
| --- | --- | --- |
| [v0.8.3](https://github.com/Sovero/hf/releases/tag/v0.8.3) · [в файле](#v-0-8-3) | 2026-09-19 | Latest |
| [v0.8.3-rc.4](https://github.com/Sovero/hf/releases/tag/v0.8.3-rc.4) · [в файле](#v-0-8-3-rc-4) | 2026-09-19 | Pre-release |
| [v0.8.3-rc.3](https://github.com/Sovero/hf/releases/tag/v0.8.3-rc.3) · [в файле](#v-0-8-3-rc-3) | 2026-09-17 | Pre-release |
| [v0.8.3-rc.2](https://github.com/Sovero/hf/releases/tag/v0.8.3-rc.2) · [в файле](#v-0-8-3-rc-2) | 2026-09-17 | Черновик |
| [v0.8.3-rc.1](https://github.com/Sovero/hf/releases/tag/v0.8.3-rc.1) · [в файле](#v-0-8-3-rc-1) | 2026-09-16 | Черновик |
| [v0.8.2](https://github.com/Sovero/hf/releases/tag/v0.8.2) · [в файле](#v-0-8-2) | 2026-09-14 | Стабильный |
| [v0.8.1](https://github.com/Sovero/hf/releases/tag/v0.8.1) · [в файле](#v-0-8-1) | 2026-09-12 | Стабильный |
| [v0.8.0](https://github.com/Sovero/hf/releases/tag/v0.8.0) · [в файле](#v-0-8-0) | 2026-09-11 | Стабильный |
| [v0.8.0-rc.1](https://github.com/Sovero/hf/releases/tag/v0.8.0-rc.1) · [в файле](#v-0-8-0-rc-1) | 2026-09-11 | Pre-release |
| [v0.7.9](https://github.com/Sovero/hf/releases/tag/v0.7.9) · [в файле](#v-0-7-9) | 2026-09-09 | Стабильный |
| [v0.7.8](https://github.com/Sovero/hf/releases/tag/v0.7.8) · [в файле](#v-0-7-8) | 2026-09-09 | Стабильный |
| [v0.7.7](https://github.com/Sovero/hf/releases/tag/v0.7.7) · [в файле](#v-0-7-7) | 2026-09-09 | Стабильный |
| [v0.7.6](https://github.com/Sovero/hf/releases/tag/v0.7.6) · [в файле](#v-0-7-6) | 2026-09-09 | Стабильный |
| [v0.7.5](https://github.com/Sovero/hf/releases/tag/v0.7.5) · [в файле](#v-0-7-5) | 2026-09-09 | Стабильный |
| [v0.7.4](https://github.com/Sovero/hf/releases/tag/v0.7.4) · [в файле](#v-0-7-4) | 2026-09-09 | Стабильный |
| [v0.7.3](https://github.com/Sovero/hf/releases/tag/v0.7.3) · [в файле](#v-0-7-3) | 2026-09-08 | Стабильный |
| [v0.7.2](https://github.com/Sovero/hf/releases/tag/v0.7.2) · [в файле](#v-0-7-2) | 2026-09-08 | Стабильный |
| [v0.7.1](https://github.com/Sovero/hf/releases/tag/v0.7.1) · [в файле](#v-0-7-1) | 2026-09-08 | Стабильный |
| [v0.7.0](https://github.com/Sovero/hf/releases/tag/v0.7.0) · [в файле](#v-0-7-0) | 2026-09-08 | Стабильный |
| [v0.6.0](https://github.com/Sovero/hf/releases/tag/v0.6.0) · [в файле](#v-0-6-0) | 2026-09-08 | Стабильный |
| [v0.5.1](https://github.com/Sovero/hf/releases/tag/v0.5.1) · [в файле](#v-0-5-1) | 2026-09-08 | Стабильный |
| [v0.5.0](https://github.com/Sovero/hf/releases/tag/v0.5.0) · [в файле](#v-0-5-0) | 2026-09-07 | Стабильный |
| [v0.4.0](https://github.com/Sovero/hf/releases/tag/v0.4.0) · [в файле](#v-0-4-0) | 2026-09-07 | Стабильный |
| [v0.3.1](https://github.com/Sovero/hf/releases/tag/v0.3.1) · [в файле](#v-0-3-1) | 2026-09-07 | Стабильный |
| [v0.3.0](https://github.com/Sovero/hf/releases/tag/v0.3.0) · [в файле](#v-0-3-0) | 2026-09-07 | Стабильный |
| [v0.2.1](https://github.com/Sovero/hf/releases/tag/v0.2.1) · [в файле](#v-0-2-1) | 2026-09-03 | Стабильный |
| [v0.2.0](https://github.com/Sovero/hf/releases/tag/v0.2.0) · [в файле](#v-0-2-0) | 2026-09-03 | Стабильный |

---

<a id="v-0-8-3"></a>

## v0.8.3 — 2026-09-19 · Latest

Первый стабильный релиз после 0.8.2: в него вошла вся линия 0.8.3-rc.1 … 0.8.3-rc.4. Установки со стабильного канала наконец получают обновление, а сборки RC переезжают на стабильную версию по semver.

### Поверхность печати

- **Рельеф строится как высотная карта яркости.** Верхняя поверхность — единая сетка с общими вершинами соседних ячеек: разница высот между соседями становится *диагональной* гранью, а не вертикальной стенкой. Тональный переход печатается непрерывным склоном, и число различимых высот растёт с числом слоёв, а не сводится к нескольким плоским плато.
- **Вертикальные стенки — только по внешнему контуру.** Боковые стенки спускаются с граничных высот к столу, дно — плоская базовой плита; внутренних стенок нет, поверхность однозначная и печатается одним проходом.
- **Рабочее разрешение поднято до 1024 px** по большой стороне (было 512): превью печати вдвое резче, дизеринг даёт более плавные переходы.
- **Калибровка τ по эталону.** Можно подать образец STL (например, вывод оригинального HueForge) и сравнить с нашим рельефом: число уровней высот, шаг сетки и форма поверхности — с таблицей расхождений.

### Интерфейс

- **Левая панель разбита на вкладки по контексту** — вместо одной длинной колонки; на вкладке проверки бейдж с числом загруженных цветов.
- **Превью рядом с настраиваемым сплиттером**: «друг над другом» и «два рядом», пропорция перетаскивается, двойной клик по разделителю возвращает 50/50; в узких окнах (< 900 px) схемы складываются в колонку.
- **Нижний грип растяжения рабочей области**: полоса с шевроном под 3D-видом растит область вниз до +1200 px (для высоких печатей); двойной клик — сброс.
- **Единый формат шапок и контролов**: иконка → заголовок → бейдж → «?», подписи во второй строке, все чекбоксы и радио приведены к одному стилю, кнопки-действия — иконки с подсказками.
- Превью «Исходное» декодируется до 2048 px (без потери деталей), карточки превью всегда одного размера, пустое состояние вместо чёрных прямоугольников, подписи на кубике вида уменьшены, анимация вращения кубика убрана — она заставляла подсветку граней мельтешить.

### Автообновление и релизы

- **Исправлено автообновление на приватном репозитории**: обновления ходят через GitHub API с сохранённым токеном.
- **RC больше не попадают в стабильный канал**: флаг pre-release для тега с дефисом выставляется автоматически, а публикация кандидата больше не перехватывает метку Latest.
- **Сборка переживает EPERM от Defender** на переименовании `win-unpacked.tmp` — обёртка над electron-builder сама пересобирает в свежий каталог и возвращает артефакты на место.
- CI-экшены подняты на Node 24 (без предупреждений об устаревшем рантайме).

### Установка

Скачайте `hueforge-desktop-setup-0.8.3.exe` и запустите — установщик не требует прав администратора. Установленные сборки обновляются сами.

**Полный changelog**: https://github.com/Sovero/hf/compare/v0.8.2...v0.8.3

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.8.3

---

<a id="v-0-8-3-rc-4"></a>

## v0.8.3-rc.4 — 2026-09-19 · Pre-release

### Интерфейс

- **Нижний грип растяжения рабочей области**: потяните полосу с шевроном под 3D-видом вниз — рабочая область вырастает до +1200px ниже края экрана (для высоких печатей); двойной клик — сброс. Шеврон подсказывает возможность растяжения и тускнеет после первого использования.
- **Детализация печати удвоена**: рабочее разрешение поднято с 512 до 1024px по большой стороне — превью печати вдвое резче по каждой оси, дизеринг даёт более плавные тональные переходы, рельеф точнее следует яркости.
- **Превью «Исходное» без потери деталей**: исходник декодируется до 2048px для превью (печатный расчёт остаётся в сопло-точном разрешении).
- **Стабильные карточки превью**: области показа всегда одинакового размера (заголовок больше не меняет раскладку при наведении), шапки пары одной высоты, канвы стартуют на одном уровне.
- **Пустое состояние**: вместо чёрных прямоугольников — локализованные подсказки, пока картинка не загружена.
- **Тумблер «Со стороны света / На просвет»** — компактные иконки вместо текста (подсказки при наведении).
- **Схема раскладки «все в ряд» удалена** — остались проверенные «друг над другом» и «два рядом».

### Надёжность

- Исправлено направление драга нижнего грипа (база с суффиксом `px` читалась как NaN).
- Исправлено сжатие правой карточки в узких окнах; сплиттер пары ограничен 30–70%.
- В узких окнах (<900px) обе схемы раскладки корректно складываются в колонку.

**Полный changelog**: https://github.com/Sovero/hf/compare/v0.8.3-rc.3...v0.8.3-rc.4

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.8.3-rc.4

---

<a id="v-0-8-3-rc-3"></a>

## v0.8.3-rc.3 — 2026-09-17 · Pre-release

Release candidate v0.8.3-rc.3 — interface consistency iteration.

### Highlights

- **Uniform panel heads** — every section across all three tabs now shares one grid format: icon and title on line 1 with the help button pinned to the right edge; status badges move to line 2 under the title and never push the help button around.
- **Icon status buttons** — text badges («All checks passed», «Not loaded», palette count) became compact circular status icons with localized tooltips; color semantics preserved (green ok, amber partial, red error).
- **Palette collapse removed** — the chevron and the collapsed state are gone; the palette list is always visible, along with its storage key and strings.
- **One style for toggles** — the ΔE merge checkbox follows the depth-mode option treatment (same text size, hover and checked highlight); checkbox/radio rows share equal heights and exact centering.
- **Calibration controls aligned** — the τ-calibration select, swatch STL button, and file picker now share one 2rem height and 6px radius, reading as a single control group.
- **Resizable preview layout** — source and quantized previews sit side by side with a width splitter, a height splitter between the previews and the 3D view, double-click resets to 50/50, and three layout presets (stacked, row, all-in-a-row) are available as icon buttons.

### Between v0.8.3-rc.2 and this RC

Same code base as rc.2 plus the interface-consistency commits `3c76a1e` (side-by-side previews with resizable splitters) and `9c3a774` (uniform panel heads and controls).

### Full Changelog

https://github.com/Sovero/hf/compare/v0.8.3-rc.2...v0.8.3-rc.3

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.8.3-rc.3

---

<a id="v-0-8-3-rc-2"></a>

## v0.8.3-rc.2 — 2026-09-17 · Черновик

Release candidate v0.8.3-rc.2 — interface polish iteration.

### Highlights

- **Sidebar section icons** — every numbered panel heading now has a pictogram in the same accent stroke style as the export buttons (image frame, palette, relief steps, dimension arrows, printer, clock, 3D cube, export arrow). Numbers stay.
- **Depth mode is its own card** — separated from the Colors section, consistent with the other numbered cards.
- **Quieter depth options** — "Light/Dark = tall" rows are normal weight and muted; the selected row gets a soft highlight instead of bold contrast.
- **Check-tab badge** — the Check tab shows the current palette color count (hidden until a palette exists).
- **Stable view cube** — removed the hover spin animation that flickered under the cursor; back to a steady face highlight.
- **Themed text selection** — accent tint instead of the browser's default blue, and clickable labels no longer highlight on double-click.

### Between v0.8.3-rc.1 and this RC

Same code base as rc.1 (brightness-driven height-map surface, reference STL/3MF comparison, auto-update fix for the private repo) plus the UI polish commit `84d4175`.

### Full Changelog

https://github.com/Sovero/hf/compare/v0.8.2...v0.8.3-rc.2

Страница релиза: https://github.com/Sovero/hf/releases/tag/untagged-86c4fc5915773d98c7fa

---

<a id="v-0-8-3-rc-1"></a>

## v0.8.3-rc.1 — 2026-09-16 · Черновик

Release candidate v0.8.3-rc.1 (target: main).

### Highlights

#### Surface geometry reworked to a true height map
- The printed top surface is now a **shared-vertex height map**, matching the original HueForge mesher: neighboring cells share grid vertices, so tonal changes print as **sloped faces** instead of per-cell staircases.
- Vertical walls remain **only on the outer contour**; the interior can no longer pinch or show step artifacts.
- Heights snap to **whole print layers** (no invented half-steps); flat areas keep their exact extent, one-cell dark lines stay grooves.
- Mesh stays watertight with **no T-junctions**; verified over random and structured height fields (every edge shared by exactly two triangles, correct volumes).
- "Brightness drives height" (from v0.8.3 line of work): each pixel's luminance sets its layer; per-color band ownership of the total height is preserved.

#### Reference comparison built in
- Drop a reference **`.stl`** (or `.3mf`) into the Reference panel: the app measures grid pitch, height steps, level count, triangle count and surface-form shares (plateaus / sloped / vertical), and shows a **line-by-line discrepancy table** with ✓ ≈ ✕ marks.

#### Left panel reorganized into tabs
- Four context tabs — **Image / Relief / Check / Export** — with a sticky WAI-ARIA tab strip (keyboard arrows supported).
- The active tab persists across restarts; the guided tour automatically opens the tab owning the spotlighted section.

#### Auto-update fixed for the private repository
- electron-updater only enables `PrivateGitHubProvider` via the publish config or `GH_TOKEN`; update checks previously hit 404. The stored token is now passed through `GH_TOKEN`, and an externally provided token is preserved.

#### Smaller fixes
- ΔE map no longer freezes the UI: CIEDE2000 is computed lazily with caching, overlay bounds in one pass, and the heat-map overlay is no longer discarded right after creation.
- ViewCube labels reduced (~0.20 of a face) so they no longer crowd the cube.
- CI: Actions bumped to Node 24 runtimes.

### Artifacts
- `hueforge-desktop-setup-0.8.3-rc.1.exe` — Windows installer (NSIS, x64) with built-in auto-update *(attached by CI)*
- `latest.yml` + blockmap — electron-updater manifests *(attached by CI)*
- deploy bundle — self-contained server+browser package *(attached by CI)*

This is a release candidate: please smoke-test the installer, the height-map relief in the slicer, and the update check before promoting to a stable v0.8.3.

**Full Changelog**: https://github.com/Sovero/hf/compare/v0.8.2...v0.8.3-rc.1

Страница релиза: https://github.com/Sovero/hf/releases/tag/untagged-12d53ab673ad14a2f9b2

---

<a id="v-0-8-2"></a>

## v0.8.2 — 2026-09-14 · Стабильный

Заметок к этому релизу нет — изменения по истории коммитов:

- feat: add frameless HueForge Desktop window

**Полный список изменений**: https://github.com/Sovero/hf/compare/v0.8.1...v0.8.2

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.8.2

---

<a id="v-0-8-1"></a>

## v0.8.1 — 2026-09-12 · Стабильный

Заметок к этому релизу нет — изменения по истории коммитов:

- docs: update release docs for stable v0.8.0

**Полный список изменений**: https://github.com/Sovero/hf/compare/v0.8.0...v0.8.1

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.8.1

---

<a id="v-0-8-0"></a>

## v0.8.0 — 2026-09-11 · Стабильный

Заметок к этому релизу нет — изменения по истории коммитов (с v0.7.9):

- ci: build the Windows installer on a native windows runner
- ci: use electron-builder's portable wine toolset for NSIS on linux
- ci: skip Windows code signing in electron-builder
- fix: build ICO directory as one contiguous block in make-icon
- fix: write correct ICO header fields in make-icon (type=1, count)
- fix: harden desktop export and auto-update for v0.8.0-rc.1
- chore: update package-lock.json for electron deps
- feat: add Electron desktop app with auto-update and printability warn-only fix
- Parse reference 3MF in a Web Worker and stream vertex bounds
- Fix reference 3MF UI defects found in review

**Полный список изменений**: https://github.com/Sovero/hf/compare/v0.7.9...v0.8.0

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.8.0

---

<a id="v-0-8-0-rc-1"></a>

## v0.8.0-rc.1 — 2026-09-11 · Pre-release

Release candidate v0.8.0-rc.1 (target: main).

### Highlights
- **Electron desktop app**: native window, NSIS installer, auto-update via electron-updater (GitHub Releases, token through safeStorage for the private repo)
- **Reference 3MF parsing in a Web Worker** with streaming vertex bounds and entry/size limits checked before inflate (zip-bomb safe)
- **Printability**: fragile isolated regions are warn-only by design (art-specific, not settings-fixable); auto-fixes remain for bands / resolution / swaps
- **Export reliability**: every save waits for the actual result of the native Save As dialog / browser download and reports saved / canceled / error
- Process-flow + architecture diagrams in docs/ for review

### Artifacts
- `hueforge-web-setup-0.8.0-rc.1.exe` — Windows installer (NSIS, x64) with built-in auto-update
- `latest.yml` + blockmap — electron-updater manifests
- `hueforge-web-v0.8.0-rc.1.zip` — source archive for install.bat
- `hueforge-web-deploy-v0.8.0-rc.1.zip` — self-contained server+browser package (built by CI, attached automatically)

This is a release candidate: please smoke-test the installer and the update check before promoting to a stable tag.

**Полный список изменений**: https://github.com/Sovero/hf/compare/v0.7.9...v0.8.0-rc.1

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.8.0-rc.1

---

<a id="v-0-7-9"></a>

## v0.7.9 — 2026-09-09 · Стабильный

#### Обновление одной командой
- **`update.ps1 download-deploy <версия>`** — скачивает готовый пакет с релиза и распаковывает его поверх папки: полное обновление без исходников и npm install.
- **`update.ps1 rollback`** — откат к предыдущей версии: перед обновлением папка автоматически сохраняется в бэкап.
- `dist/` при обновлении заменяется начисто (`robocopy /MIR`) — старые файлы сборки больше не копятся.

#### Высоты полос как в HueForge
- Новая кнопка **«По прозрачности (τ)»** в палитре: толщина каждого листа считается из прозрачности филамента (как HueForge использует TD) — прозрачные цвета печатаются толще, непрозрачные тоньше; общая высота модели не меняется. После калибровки τ из фото разброс высот появляется автоматически.

#### Иконки, тултипы и интерфейс
- Иконки на всех кнопках действий; режимы 3D-вьюера (Модель / ΔE-карта / Срез слоя) — пиктограммы и всплывающие подсказки; те же иконки показывает ознакомительный тур.
- Язык и тема в шапке — компактные кнопки с иконками (глобус с кодом языка; луна/солнце по теме) и меню выбора.
- Кнопки экспорта выровнены в едином стиле со всеми остальными.
- Контраст текста в темах Nord и Solar доведён до нормы WCAG.

#### Подсказки
- Уточнено описание модели: верхняя поверхность — ступенчатый рельеф листов (не гладкая); добавлена практика HueForge «нижние листы толще верхних».
- Компактные подписи радио-кнопок режима глубины.

#### Установка
1. Распакуйте `hueforge-web-deploy-v0.7.9.zip` в любую папку.
2. Запустите **`deploy.bat`** — откроется браузер на `http://127.0.0.1:8080`.
3. Нужен только Node.js LTS (устанавливается один раз).

Обновление со старой версии: закройте старый `deploy.bat`, распакуйте архив поверх старой папки и запустите `deploy.bat` — или используйте `update.ps1 download-deploy v0.7.9` (см. DEPLOY.md).

**Полный список изменений**: https://github.com/Sovero/hf/compare/v0.7.8...v0.7.9

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.7.9

---

<a id="v-0-7-8"></a>

## v0.7.8 — 2026-09-09 · Стабильный

### Автоисправление ошибок
- У проблемных проверок в разделе «Проверка печатаемости» появилась кнопка **«Исправить»**: одно нажатие подбирает настройки (макс. высота, размер печати, высоты полос) и пересчитывает модель. Исправление проверяется по той же математике слоёв, что и сама печать, — предложенное значение гарантированно убирает ошибку.
- Исправлена ложная ошибка «Цветовые полосы тоньше одного слоя»: полоса ровно в один слой печатается нормально и больше не помечается ошибкой (теперь это корректное предупреждение о толщине относительно сопла).

### Интерфейс
- Заголовки панелей сжимаются с многоточием — кнопки «?»/«↺» не вылезают за границы даже в узком окне.
- Номер версии в шапке подставляется автоматически из сборки и всегда совпадает с фактической версией.

### Установка
1. Установите [Node.js LTS](https://nodejs.org) (один раз).
2. Скачайте **`hueforge-web-deploy-v0.7.8.zip`** (внизу страницы) и распакуйте в любую папку.
3. Дважды щёлкните **`deploy.bat`** — откроется браузер на `http://127.0.0.1:8080`.

Обновление: распакуйте новый zip поверх старой папки — настройки, тема и язык сохраняются (они хранятся в браузере). Подробный чек-лист — в DEPLOY.md внутри пакета. Полный исходный код — в архиве `hueforge-web-v0.7.8.zip`.

**Проверено CI:** typecheck, 245/245 тестов, сборка, релизный конвейер — всё зелёное.

**Полный список изменений**: https://github.com/Sovero/hf/compare/v0.7.7...v0.7.8

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.7.8

---

<a id="v-0-7-7"></a>

## v0.7.7 — 2026-09-09 · Стабильный

### 3D-вьюер
- Ортографический вид сверху (кнопка рядом с «домом») — точная проверка площади модели.
- Сплошная плита стола под сеткой, мягкая контактная тень под моделью.
- Оси проходят через центр стола; все быстрые переходы центрируются.
- Qidi Q2 (270×270 мм) в каталоге принтеров — теперь 16 моделей.

### Палитра и интерфейс
- Панель палитры сворачивается до полосы покрытия.
- Полные сведения строки (мм · слои · доля · τ) — в тултипе при наведении.
- Строки палитры в две линии, кнопки-чипы переносятся — ничего не вылезает за границы.
- Нативные элементы (флажки, поля, ползунки) приведены к теме приложения.

### Документация
- Схема архитектуры приложения (docs/architecture-diagram.html).

### Установка
1. Установите [Node.js LTS](https://nodejs.org) (один раз).
2. Скачайте **`hueforge-web-deploy-v0.7.7.zip`** (внизу страницы) и распакуйте в любую папку.
3. Дважды щёлкните **`deploy.bat`** — откроется браузер на `http://127.0.0.1:8080`.

Обновление: распакуйте новый zip поверх старой папки (или используйте `update.ps1` из предыдущей поставки). Полный исходный код — в архиве `hueforge-web-v0.7.7.zip`.

**Проверено CI:** typecheck, 240/240 тестов, сборка — всё зелёное.

---

**Пакет обновлён (пересобран 09.09):** `hueforge-web-deploy-v0.7.7.zip` — добавлен фикс переполнения шапок панелей (заголовки сжимаются с многоточием, кнопки «?»/«↺» не вылезают за край) и расширенная инструкция DEPLOY.md с чек-листом обновления.

**Полный список изменений**: https://github.com/Sovero/hf/compare/v0.7.6...v0.7.7

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.7.7

---

<a id="v-0-7-6"></a>

## v0.7.6 — 2026-09-09 · Стабильный

Десять улучшений интерфейса и анализа перед печатью.

#### Новое
- **Стол реального принтера в 3D**: выберите модель (Bambu Lab, Prusa, Creality, Anycubic, Sovol, FlashForge, Qidi, Ultimaker) — полупрозрачный стол покажет, влезает ли модель и сколько места занимает.
- **Габариты модели** (Ш × Г × В, мм) подписью под 3D-видом; высота — фактическая, как в экспорте.
- **3D-режимы анализа**: ΔE-карта ошибок прямо на модели и «Срез слоя» — разрез на высоте ползунка слоёв.
- **Список покупок**: TXT со всеми филаментами палитры — бренд, материал, цвет, hex, полосы и доля площади.
- **НИТ (ПК НИТ, Волгоград)** — девятый производитель в библиотеке филаментов (19 цветов × PLA/PETG/ABS).

#### Улучшено
- **Поиск и «Недавние» в диалоге «Собрать из каталога»**: фильтр по цвету/бренду/материалу на двух языках и ряд последних использованных катушек в один клик.
- **Настраиваемый порог «почти не используется»**: поле в % рядом с кнопкой «Убрать неиспользуемые»; в подсказке — мини-схема, к какому цвету перейдут пиксели убранной катушки.
- **Центрирование модели на столе** — объект больше не висит с угла.
- Ползунок слоёв выровнен по той же математике, что и ползунок цветов.

#### Установка
1. Установите [Node.js LTS](https://nodejs.org) (один раз).
2. Скачайте **hueforge-web-deploy-v0.7.6.zip** и распакуйте в любую папку.
3. Запустите **deploy.bat** — откроется браузер на http://127.0.0.1:8080.

---
🤖 Generated with Codebuff

**Полный список изменений**: https://github.com/Sovero/hf/compare/v0.7.5...v0.7.6

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.7.6

---

<a id="v-0-7-5"></a>

## v0.7.5 — 2026-09-09 · Стабильный

Палитра катушек и наведение красоты:

- **Убрать неиспользуемые** — кнопка в режиме «по катушкам» всегда на виду: показывает, сколько катушек почти не используется (<1% площади) и какие именно уберёт; один клик пересчитывает палитру без них и экономит смены филамента
- **Сливать близкие цвета (ΔE)** — новая галочка с порогом в разделе «Цвета»: соседние полосы с почти одинаковыми цветами (CIE76 ΔE ниже порога) печатаются одним филаментом; слитая полоса сохраняет высокий уступ, ★-назначения следуют за цветами
- **Шкала покрытия** — горизонтальная полоса между строками палитры: ширина сегмента = доля цвета на печати; баланс цветов и «мёртвые» катушки видны с первого взгляда
- **3D-вид** — стол теперь точно по размеру печати (прямоугольный, с полем), оси в углу начала координат: модель больше не свисает с края стола

Прочее: доля площади каждого цвета в строках палитры, единый диалог «Собрать из каталога» для пошагового выбора N катушек, автоподбор ближайших филаментов, ViewCube и кнопка «Домой» в 3D, undo/redo (Ctrl+Z/Y), панель производительности.

**Установка:** распакуйте `hueforge-web-deploy-v0.7.5.zip`, установите Node.js LTS (если ещё нет) и запустите `deploy.bat` — сервер поднимется на `http://127.0.0.1:8080`.

**Полные изменения:** https://github.com/Sovero/hf/compare/v0.7.4...v0.7.5

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.7.5

---

<a id="v-0-7-4"></a>

## v0.7.4 — 2026-09-09 · Стабильный

### Новое в v0.7.4

#### Палитра из реальных катушек — за один шаг
- **«Собрать из каталога»**: модальный диалог — выберите бренд → материал и отметьте сразу N катушек; палитра, назначения и квантование собираются одним кликом («Квантовать по катушкам» без назначений теперь открывает его)
- **«Автоподбор филаментов»**: одна кнопка подбирает ближайший реальный филамент к каждому цвету палитры (без повторов), принимает точные цвета катушек — затем правьте вручную через ★

#### Контроль палитры
- **Доля площади** каждого цвета в строке палитры — процент площади печати после дизеринга и чистки
- **Предупреждение о неиспользуемых катушках**: цвета меньше 1% площади выводятся в сводку — каждая смена филамента стоит времени принтера

#### Навигация и удобство
- **ViewCube как в Fusion 360**: куб ориентации в углу 3D-вида — клик по грани/ребру/углу, кнопка «Домой», цветные оси X/Y/Z
- **Undo/Redo** (Ctrl+Z / Ctrl+Y): правки палитры, высот полос, τ и всех настроек, до 50 шагов
- **Панель «Производительность»**: время квантования и сборки меша, буферы, отброшенные ответы воркера

**189 тестов**, CI и Release-воркфлоу зелёные.

📦 **Ассеты:** `hueforge-web-deploy-v0.7.4.zip` — распакуйте и запустите `deploy.bat` (нужен только Node.js). `update.ps1` подхватит этот релиз автоматически.

**Полный список изменений:** https://github.com/Sovero/hf/compare/v0.7.3...v0.7.4

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.7.4

---

<a id="v-0-7-3"></a>

## v0.7.3 — 2026-09-08 · Стабильный

_сохранение проектов, ΔE-карта, высоты полос и воркер_

### 🗂 Сохранение/загрузка проекта (`.hueforge.json`)
- Кнопки **«Сохранить проект» / «Открыть проект»** в панели экспорта
- Файл переносимый: оригинал картинки, все настройки, палитра (цвета, τ, назначенные филаменты) — пользовательские филаменты встраиваются полностью
- Жёсткая валидация с понятными ошибками

### 🎯 ΔE-карта ошибок
- Heatmap расхождения целевой картинки с предсказанным видом печати (с учётом просвечивания)
- Средний и максимальный ΔE, легенда 0–25+; слабые места видны до печати

### 📏 Индивидуальные высоты полос (как в HueForge)
- Ползунок толщины у каждого цвета в палитре; сумма полос = общая высота («Макс. высота» становится производной)
- Кнопка «Равные высоты»; высоты сохраняются в проекте
- Проверка печатаемости сообщает реальную самую тонкую полосу

### ⚡ Конвейер в Web Worker
- Квантование и сборка меша больше не блокируют интерфейс: 512×512 пересчитывается в фоне при ~54 fps
- Коалесцинг пересборок и отмена устаревших ответов

### 🎨 Прочее
- Кнопки калибровки τ (образец STL, выбор фото) в тёмной теме приложения
- Читаемый текст заблокированной кнопки «Далее» в туре

**Ассеты:** `hueforge-web-deploy-v0.7.3.zip` — готовый пакет для запуска (`deploy.bat`), `hueforge-web-v0.7.3.zip` — исходники.

**Полный список изменений**: https://github.com/Sovero/hf/compare/v0.7.2...v0.7.3

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.7.3

---

<a id="v-0-7-2"></a>

## v0.7.2 — 2026-09-08 · Стабильный

### Что нового

**📊 Живой статус на ручном шаге тура** (`e7487f9`)
- На шаге «Количество цветов» теперь показывается мини-сравнение «до → после» — пилюля с текущим значением ползунка, обновляющаяся прямо во время движения
- Рядом — накопительный счётчик «Вы изменили N параметров» с корректными формами множественного числа (1 параметр / 2 параметра / 5 параметров)
- Статус честный: вернули ползунок на исходное значение — счётчик обнуляется
- Счётчик готов к накоплению по всем ручным шагам тура

### Установка / обновление

- **Новый ПК:** `hueforge-web-deploy-v0.7.2.zip` → распаковать → `deploy.bat`
- **Уже установлено:** запустите `update.ps1` (или `install.bat`) — подтянет Latest автоматически
- **Исходники:** `hueforge-web-v0.7.2.zip`

**Полный список изменений**: https://github.com/Sovero/hf/compare/v0.7.1...v0.7.2

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.7.2

---

<a id="v-0-7-1"></a>

## v0.7.1 — 2026-09-08 · Стабильный

### Что нового

Продолжение работы над ознакомительным туром из v0.7.0:

**🎯 Шаги по отдельным контролам** (`178465b`)
- Тур раскрывает разделы до конкретных элементов: ползунок цветов, дизеринг и каждое поле размеров (ширина, высота, основание, макс. высота, высота слоя)
- На каждом целевом шаге — пульсирующая точка-фокус в углу подсветки

**🔘 Кликабельные точки прогресса** (`2931e36`)
- В карточке тура ряд из точек по числу шагов: активный — синяя «таблетка», пройденные — приглушённые, будущие — серые
- Клик по точке мгновенно переходит к нужному шагу

**👋 Онбординг только при первом визите** (`cfb5b41`)
- Приветствие и автостарт тура показываются один раз: завершение/пропуск тура или «Скрыть» убирают их навсегда
- Кнопка «Тур» в верхней панели остаётся для ручного запуска

**🤝 Ручной шаг «Количество цветов»** (`dea0281`)
- «Далее» заблокирован, пока пользователь не подвинет ползунок: подсказка приглашает попробовать и сменяется зелёным ✓ после первого движения
- Стрелки на сфокусированном ползунке двигают ползунок, а не листают тур

**🎨 Мелочь** (`692075a`)
- Починен контраст главной кнопки тура: при наведении надпись больше не сливается с синим фоном

### Установка / обновление

- **Новый ПК:** `hueforge-web-deploy-v0.7.1.zip` → распаковать → `deploy.bat`
- **Уже установлено:** запустите `update.ps1` (или `install.bat`) — подтянет Latest автоматически
- **Исходники:** `hueforge-web-v0.7.1.zip`

**Полный список изменений**: https://github.com/Sovero/hf/compare/v0.7.0...v0.7.1

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.7.1

---

<a id="v-0-7-0"></a>

## v0.7.0 — 2026-09-08 · Стабильный

### Что нового

**🎓 Ознакомительный тур с подсветкой** (`e08e6d5`)
- Пошаговый тур по всем разделам: затемняет интерфейс и подсвечивает один раздел за другим — Изображение → Цвета → Глубина → Размер → Палитра → Проверка → Экспорт
- Управление: кнопки «Пропустить / Назад / Далее», стрелки ←→, Esc
- Автоматически стартует после баннера первого запуска; перезапуск — кнопка «Тур» в верхней панели

**👋 Приветствие внутри приложения** (`e08e6d5`)
- Welcome-блок теперь настоящая панель в интерфейсе (заголовок + «Начать тур» / «Скрыть»), а не всплывающее окно
- «Скрыть» запоминается между запусками

**❓ Подсказки разделов** (`e08e6d5`)
- Пояснительные абзацы перенесены в кнопку «?» в заголовке каждого раздела — интерфейс компактнее, текст доступен при наведении

**📐 Мелочи**
- `a1770f7` — отступ между рядами кнопок экспорта (кнопки больше не склеены)

### Установка / обновление

- **Новый ПК:** `hueforge-web-deploy-v0.7.0.zip` → распаковать → `deploy.bat`
- **Уже установлено:** запустите `update.ps1` (или `install.bat`) — подтянет Latest автоматически
- **Исходники:** `hueforge-web-v0.7.0.zip`

**Полный список изменений**: https://github.com/Sovero/hf/compare/v0.6.0...v0.7.0

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.7.0

---

<a id="v-0-6-0"></a>

## v0.6.0 — 2026-09-08 · Стабильный

### What changed

- **Backlight viewing mode** — a Front-lit / Backlight toggle on the print-preview card. Backlight folds incident white light through the whole sheet stack (transmission only, no opaque base reflection), so thin dark areas glow where light leaks through — the classic HueForge lamp/window display. The base slab participates in the fold, per-filament τ values apply in both modes, the choice persists across sessions, and the canvas backdrop darkens in backlit mode.
- **Export buttons re-laid out** — a responsive 2-column grid replaces the cramped single row: uniform one-line buttons for STL / 3MF / Describe.txt / Slicer bundle, with the Open-in-slicer row on its own line.
- **Calibration panel appears only when it can work** — the per-filament opacity calibration (color picker, swatch STL, photo fit) stays hidden until an image is loaded, instead of showing an empty select and a dangling file input.

### Upgrade

- **Existing installs:** run `update.ps1` — it picks up v0.6.0 (Latest) automatically.
- **New PC:** download `hueforge-web-deploy-v0.6.0.zip`, unpack, double-click `deploy.bat` (only Node.js needed). For the "Open in slicer" hand-off, run `deploy-slicer.bat` instead.

**Full changelog:** https://github.com/Sovero/hf/compare/v0.5.1...v0.6.0

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.6.0

---

<a id="v-0-5-1"></a>

## v0.5.1 — 2026-09-08 · Стабильный

### What changed

- **Dither-aware printability warning** — the fragile-speck check now judges the pre-dither label map when Floyd–Steinberg dithering is active. Intentional dither dots at band boundaries no longer trigger a warning storm; the check explains this in both languages (a note on warnings, and on the all-clear detail).

### Upgrade

- **Existing installs:** run `update.ps1` — it picks up v0.5.1 (Latest) automatically.
- **New PC:** download `hueforge-web-deploy-v0.5.1.zip`, unpack, double-click `deploy.bat` (only Node.js needed). For the "Open in slicer" hand-off, run `deploy-slicer.bat` instead.

**Full changelog:** https://github.com/Sovero/hf/compare/v0.5.0...v0.5.1

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.5.1

---

<a id="v-0-5-0"></a>

## v0.5.0 — 2026-09-07 · Стабильный

### What changed

#### Added
- **Floyd–Steinberg dithering** — a strength slider (0–100%, persisted) in the Colors panel. Band boundaries become smooth dithered gradients mixing the two adjacent filaments instead of hard steps; filament colors and the swap schedule stay unchanged. Applies to previews, mesh, STL/3MF and Describe via the same indexMap.
- **Open in slicer (opt-in)** — with the server started via `deploy-slicer.bat` (or `--allow-slicer` / `HF_ALLOW_SLICER=1`), an "Open in slicer" button in Export sends the exported 3MF straight to a slicer installed on this PC (Bambu Studio / OrcaSlicer / PrusaSlicer, auto-discovered; custom path via `HF_SLICER_PATH`). CSRF-guarded, loopback-only, off by default.

### Upgrade

- **Existing installs:** run `update.ps1` (or `install.bat`) to pull `v0.5.0`.
- **Fresh PC:** download **`hueforge-web-deploy-v0.5.0.zip`**, unzip, double-click `deploy.bat` (or `deploy-slicer.bat` for the slicer hand-off) — only Node.js required.

**Full Changelog**: https://github.com/Sovero/hf/compare/v0.4.0...v0.5.0

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.5.0

---

<a id="v-0-4-0"></a>

## v0.4.0 — 2026-09-07 · Стабильный

### What changed

#### Added
- **PrusaSlicer slicer bundle** — one-click ZIP export: `config.ini` (layer height, 100% infill, no supports) with **M600 color changes prewired** as conditional layer-change G-code (*File → Import → Import Config…* and slice — swaps fire automatically), plus an optional Node post-processing script with a Windows `.bat` wrapper and a bilingual README.
- **Per-filament opacity (τ) with calibration** — real spools differ; now every palette color has its own opacity length. Print the generated stepped **calibration swatch** (base slab + 7 steps of one color, one filament swap), photograph it, click the base and each step — the app fits τ from your photo (exposure-corrected, median-robust) and the previews match the real spool.
- **Translucent print preview** — the main color-reduced preview now shows the true transmitted blend of each column (thin top sheets let the layers below shine through), not opaque band colors.

#### Changed
- **Describe.txt and the slicer bundle share one swap schedule** — bands thinner than a layer collapse into a single swap (the unreachable sub-layer color is marked "never printed"), so every export agrees layer-for-layer.

### Upgrade

- **Existing installs:** run `update.ps1` (or `install.bat`) to pull `v0.4.0`.
- **Fresh PC:** download **`hueforge-web-deploy-v0.4.0.zip`**, unzip, double-click `deploy.bat` — only Node.js required.

**Full Changelog**: https://github.com/Sovero/hf/compare/v0.3.1...v0.4.0

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.4.0

---

<a id="v-0-3-1"></a>

## v0.3.1 — 2026-09-07 · Стабильный

### What changed

#### Fixed
- **Section titles left-aligned** — after the hide-button removal, `justify-content: space-between` flung every panel title to the right edge; titles now sit next to their number again, badges stay pinned right.

#### Changed
- **All sections always expanded** — the collapsing/chevron machinery introduced in v0.3.0 is removed entirely: every sidebar panel and every viewer card (Source, Color-reduced, Layer view, 3D) renders fully open, with no click affordance. Status badges (Reference "Не загружен", printability warnings) remain in the headers.

### Upgrade

- **Existing installs:** run `update.ps1` (or `install.bat`) to pull `v0.3.1`.
- **Fresh PC:** download **`hueforge-web-deploy-v0.3.1.zip`**, unzip, double-click `deploy.bat` — only Node.js required.

**Full Changelog**: https://github.com/Sovero/hf/compare/v0.3.0...v0.3.1

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.3.1

---

<a id="v-0-3-0"></a>

## v0.3.0 — 2026-09-07 · Стабильный

### 🚀 Features

- **Reference 3MF import** — load a HueForge-style 3MF, review its settings, and apply them to the current session non-destructively
- **Filament library** — 8 popular Russian brands plus custom filament support
- **Layer-by-layer preview** with a translucent-filament transmission model (thin top sheets let lower layers shine through, like a real HueForge print)
- **Printability improvements** — fragile specks below the minimum area are removed automatically; a warnings badge on the collapsed section summary shows problems at a glance

### 🖥 UI

- All sections and viewer cards are collapsible; the app starts fully collapsed and opens the previews when an image is processed
- Printability warnings badge on the collapsed summary
- Onboarding help texts in English and Russian

### 📦 Deployment

- Self-contained deploy package: `hueforge-web-deploy-v0.3.0.zip` — unzip on any PC with Node.js and run `deploy.bat`; no `npm install` needed
- Source archive (`hueforge-web-v0.3.0.zip`) for the existing `install.bat` flow

**Full Changelog**: https://github.com/Sovero/hf/compare/v0.2.1...v0.3.0

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.3.0

---

<a id="v-0-2-1"></a>

## v0.2.1 — 2026-09-03 · Стабильный

Заметок к этому релизу нет — изменения по истории коммитов:

- Bump version to 0.2.1
- Add one-time first-run language choice banner
- Translate nearest-filament names in the palette legend
- Add English/Russian interface with a language switcher
- Add token-based self-update for the private repository

**Полный список изменений**: https://github.com/Sovero/hf/compare/v0.2.0...v0.2.1

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.2.1

---

<a id="v-0-2-0"></a>

## v0.2.0 — 2026-09-03 · Стабильный

Заметок к этому релизу нет, отдельных изменений относительно предыдущего тоже.

**Полный список изменений**: https://github.com/Sovero/hf/commits/v0.2.0

Страница релиза: https://github.com/Sovero/hf/releases/tag/v0.2.0

<!-- releases:end -->
