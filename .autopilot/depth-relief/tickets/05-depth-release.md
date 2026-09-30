# 05 — Документация, лицензии, проверка

**Требования:** R07i, G01, R05i
**Blocked by:** 01, 02, 03, 04
**Status:** ready

## Что должно заработать

README, DEPLOY и CHANGELOG (на русском) описывают режим «По глубине», вшитую модель и импорт карты. Лицензии Apache-2.0 (модель) и MIT (`onnxruntime-web`) лежат в сборке. Сборка и тесты проверены; результат проверки на реальной модели описан честно, включая непроверенное.

## Разделы спеки

История 9; Ограничения проверки; Тест-шов 3–4.

## Acceptance criteria

- [x] `README.md` и `DEPLOY.md` на русском; размер сборки (замер ~25 МБ) и офлайн-работа описаны. `CHANGELOG.md` не правился: он генерируется из релизов (`changelog:sync`), ноты версии пишутся под конкретный тег.
- [x] `src/assets/depth-anything-v2-small/` содержит `LICENSE` (Apache-2.0) и `NOTICE.md` (происхождение, sha256); `public/THIRD_PARTY_NOTICES.txt` (Apache-2.0 + MIT) попадает в `dist/`, deploy-архив и `app.asar`.
- [x] `npm run typecheck`, `npm test` (509), `npm run build` — чистые; deploy-архив 24,5 МБ содержит модель, wasm и лицензии.
- [x] Сквозная проверка с реальной моделью: Chromium на production-сборке и на dev-сервере Vite (как `start.bat`), Electron из каталога и из `app.asar`; запросы только на свой origin; профиль высот по STL одинаков в production и dev (Chromium). Путь сбоя проверен: при недоступной модели — откат на яркость, причина в строке под источником, повторный выбор работает.
- [x] Отчёт: проверено на Linux; не проверено — установщик `.exe` и запуск на Windows.

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
