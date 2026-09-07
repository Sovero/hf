# 03 — Reference 3MF UI

**Требования:** R01, R02i, R04i, R05i, R06i, R07i, G01
**Blocked by:** 01, 02
**Status:** done

## Что должно заработать

Add a separate reference 3MF upload/dropzone and an analysis panel in English/Russian. The panel has a clear empty state, processing state, success/partial state, invalid-file error state, model summary, palette/order, swap timeline, missing-data warnings, and an explicit Apply to editor action. The current image workflow remains independent; loading a reference never clears or replaces it.

## Из брифа, дословно

> “Import and analyze reference 3MF”
> “Analyze first, then offer “Apply to editor” (Recommended)”

## Разделы спеки

Stories 1–5, 7–10; UI adapter; Apply semantics; Failure and limits; Test seam 3.

## Acceptance criteria

- [ ] User can click or drag a `.3mf` into a separate reference area without affecting the image input.
- [ ] Empty, processing, complete, partial, and error states are localized in English and Russian.
- [ ] Report shows file/model summary, bounds, palette/order, swap heights/layers, and missing fields using safe text rendering.
- [ ] Apply is disabled when no image or incompatible data exists; otherwise it explicitly reprocesses the existing image and refreshes previews/exports.
- [ ] A reference selection can be replaced without stale report data or stale Apply actions.
- [ ] Existing image → STL/3MF workflow remains usable and typecheck/build/tests pass.

## Test command

`npm run typecheck && npm test && npm run build`

## Return contract

End with exactly:

```text
STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
FILES: ...
TESTS: ...
INTERFACES: ...
REQUIREMENTS: ...
CONCERNS: ...
BLOCKERS: ...
```
