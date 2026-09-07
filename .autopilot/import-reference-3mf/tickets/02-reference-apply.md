# 02 — Apply reference settings

**Требования:** R05i, G03, R07i
**Blocked by:** 01
**Status:** done

## Что должно заработать

A public apply adapter converts a validated reference analysis into existing editor settings and palette data without replacing the current image. It supports the app’s allowed color counts, preserves internal swap boundaries on the existing layer grid, uses the exact reference max height as the final top, and reports which fields were applied or unavailable.

If the reference cannot be represented by the editor, the adapter returns a blocking reason instead of silently changing the color count or schedule.

## Из брифа, дословно

> “Analyze first, then offer “Apply to editor” (Recommended)”
> “Colors, layer height, dimensions, base/max height, and swap schedule (Recommended)”

## Разделы спеки

Story 8; Apply semantics; Test seam 2.

## Acceptance criteria

- [ ] Applying a complete compatible report changes only editor settings/palette/band schedule; the current loaded image object is preserved.
- [ ] Unsupported reference color count or invalid ascending swap schedule returns a clear blocked result.
- [ ] Missing optional fields are reported and do not overwrite existing controls.
- [ ] Palette order and `darkIsTall` mapping remain deterministic for both depth modes.
- [ ] Tests verify the public adapter with a fixture image and do not require DOM rendering.

## Test command

`npm test -- src/test/reference3mf-apply.test.ts`

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
