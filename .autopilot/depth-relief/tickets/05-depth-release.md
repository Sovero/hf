# 05 — Документация, лицензии, проверка

**Требования:** R07i, G01, R05i
**Blocked by:** 01, 02, 03, 04
**Status:** ready

## Что должно заработать

README, DEPLOY и CHANGELOG (на русском) описывают режим «По глубине», вшитую модель и импорт карты. Лицензии Apache-2.0 (модель) и MIT (`onnxruntime-web`) лежат в сборке. Сборка и тесты проверены; результат проверки на реальной модели описан честно, включая непроверенное.

## Разделы спеки

История 9; Ограничения проверки; Тест-шов 3–4.

## Acceptance criteria

- [ ] `README.md`, `DEPLOY.md`, `CHANGELOG.md` на русском; размер сборки и офлайн-работа описаны.
- [ ] `public/models/depth-anything-v2-small/` содержит LICENSE/NOTICE; лицензия ORT — в `dist`/установщике.
- [ ] `npm run typecheck`, `npm test`, `npm run build` — чистые; deploy-zip содержит модель.
- [ ] Сквозная проверка в Chromium (Playwright) с реальной моделью: выбор «По глубине» → рельеф, без запросов вне `'self'`.
- [ ] Отчёт: что проверено, что нет (Electron/Windows).

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
