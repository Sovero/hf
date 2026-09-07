# Что уже построено

Читается каждым исполнителем до начала работы. Не изобретай заново то, что здесь есть.

## Общие правила проекта

- Existing stack: Vite + TypeScript + Vitest, browser-only client application.
- Commands: `npm run typecheck`, `npm test`, `npm run build`.
- Existing 3MF generation remains owned by `src/lib/export3mf.ts`; reference parsing must not mutate the exporter contract unexpectedly.
- No new dependency unless the repository already uses it. `fflate` is the existing ZIP dependency.
- Do not put imported XML into `innerHTML`; render values with `textContent`.
- Workspace policy: leave changes uncommitted unless the user explicitly requests a commit.

## Current domain contracts

- `PipelineResult` contains `image`, `quantized`, `palette`, `field`, `mesh`, `darkIsTall`, and resolved `settings`.
- `PaletteEntry` contains `color`, `topZMm`, and 1-based `printOrder`.
- `PrintSettings` contains `widthMm`, `heightMm`, `baseMm`, `maxHeightMm`, `darkIsTall`, and `layerMm`.
- Existing `export3mfFile(result, name)` returns a zipped `Uint8Array`; existing metadata is in model XML and custom per-layer XML.

## Ticket 01 — Reference parser

- `parseReference3mf(input: File | ArrayBuffer | Uint8Array) -> Promise<Reference3mfAnalysis>` in `src/lib/reference3mf.ts`.
- `Reference3mfAnalysis` includes `model`, `palette`, `swaps`, `settings`, `missingFields`, `warnings`, `status`, `canApply`, and optional `applyBlockedReason`.
- Parser limits: 100 MB input, 25 MB known ZIP entry; only known model/custom-gcode/filament entries are read.
- App exports now record `WidthMm`, `HeightMm`, `BaseMm`, `MaxHeightMm`, `LayerMm`, and normalized `BandTops` metadata alongside existing palette/depth metadata.
- Tests: `src/test/reference3mf.test.ts`, 5 passing.

## Ticket 02 — Reference apply adapter

- `src/lib/referenceApply.ts`:
  - `planReferenceApply(analysis: Reference3mfAnalysis, current: CurrentEditorOptions) -> ReferenceApplyPlan` — pure; decides blocked/representable fields. `ReferenceApplyPlan` carries `options: PipelineOptions`, `paletteOverride: RGB[] | null` (dark→light), `bandTopsOverride: number[] | null` (usable-height fractions, last = 1), per-field `ReferenceFieldReport[]` (`applied | unavailable | fallback`), `warnings`.
  - `reprocessWithReference(image: LoadedImage, plan) -> PipelineResult` — re-quantizes the CURRENT image, overrides `quantized.palette`/`quantized.bandTops`, then `finishPipeline`. Never replaces the image object.
- Blocked when: `!analysis.canApply`, unsupported color count, max ≤ base, or a schedule that cannot map onto n−1 ascending internal boundaries.
- Schedule recovery: `bandTops` metadata first; else tool-change layers (repeated-tool runs = per-layer data → boundary at last layer of each tool; otherwise change-list convention). No tool info → schedule falls back to image-derived bands.
- Depth mode: explicit metadata wins; else inferred from print order vs luminance (dark printed last → darkIsTall).
- Tests: `src/test/referenceApply.test.ts`, 9 passing.

## Ticket 03 — Reference UI

- `index.html`: a separate `Reference 3MF` panel (dropzone `#ref-drop` + `#ref-input`, report `#ref-report` with model line, palette rows, swap schedule, missing-fields and warnings sections, `#ref-apply` button, `#ref-error`).
- `src/ui/main.ts`: `setupReference()` binds drop/click/change → `analyzeReference(file)` → `parseReference3mf` + `planReferenceApply(currentEditorOptions())` → `renderReferenceReport()`; Apply loads plan options into the shared controls (persisted via `saveSettings`), calls `reprocessWithReference(current.image, plan)`, and refreshes previews/exports. Errors render localized text keyed by `Reference3mfParseError.code`; all values via `textContent`.
- `src/i18n.ts`: `ref*` keys (en/ru) + `tris` plural word.
- `src/ui/styles.css`: `.ref-*` styles.
- Verified live in the browser: empty → report (complete) → Apply (controls switch 200→40 mm, 6→4 colors, image preserved) → invalid-file error state.
- Tests: full suite 60/60, typecheck, production build.

