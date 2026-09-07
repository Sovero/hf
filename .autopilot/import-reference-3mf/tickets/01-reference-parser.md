# 01 — Reference 3MF parser

**Требования:** R01, R03i, R04i, R06i, R07i, G02
**Blocked by:** none
**Status:** ready

## Что должно заработать

A public parser accepts a local 3MF file/byte buffer and returns a typed reference analysis for HueForge/Bambu-style files and this app’s exports. It reads the standard model XML, aggregate mesh bounds and triangle count, known app metadata, Bambu custom per-layer changes, and filament settings. It returns complete or partial status with missing-field/warning details instead of guessing absent values.

Invalid ZIP, missing model part, malformed XML, unsupported units, oversized input, and oversized known entries return typed user-facing errors without mutating app state.

## Из брифа, дословно

> “Import and analyze reference 3MF”
> “HueForge/Bambu-style files plus this app’s exports (Recommended)”

## Разделы спеки

Stories 1–4 and 6–9; Architecture; Analysis data; Failure and limits; Test seam 1.

## Acceptance criteria

- [ ] Parser exposes stable types for model summary, palette, swaps, settings, missing fields, warnings, and apply readiness.
- [ ] App-export fixture recovers model size/height, triangle count, palette metadata, print order, layer height, base/max/depth settings, and swap entries.
- [ ] Bambu/HueForge-style fixture recovers custom layer swaps and palette colors when app metadata is absent.
- [ ] Missing optional parts produce `partial` analysis and explicit missing fields, not invented defaults.
- [ ] Invalid archive/XML/unit and file/entry size limits produce typed errors.
- [ ] Parser tests run through the public parser seam and do not depend on UI internals.

## Test command

`npm test -- src/test/reference3mf.test.ts`

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
