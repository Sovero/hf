# 01 — Движок глубины

**Требования:** R01, G01, G02, R02i, R05i
**Blocked by:** none
**Status:** ready

## Что должно заработать

Из картинки (RGBA) получается `DepthMap` (0..1, ближе = больше) полностью локально: `onnxruntime-web` (wasm) исполняет вшитую `model_quantized.onnx` в отдельном воркере. Модель и wasm читаются обычным `fetch` из собственной сборки (в вебе и в Electron), в воркер уходят байтами. Сетевых запросов наружу нет; CSP не меняется.

## Из брифа, дословно

> «Нейросеть, вшитая в сборку»
> «model_quantized.onnx»

## Разделы спеки

Решение (Модель, Вход/выход, Рантайм, Отдельный воркер, Разрешение оценки, Нормализация, CSP); Тест-швы 1 и 3.

## Acceptance criteria

- [ ] `src/lib/depth/` содержит чистые функции: расчёт размера (кратно 14, длинная сторона ≤ 518), предобработка в тензор, нормализация по перцентилям, билинейный ресайз `DepthMap`.
- [x] Обёртка над ONNX Runtime за интерфейсом `DepthEstimator`; байты модели и wasm передаются снаружи.
- [x] `depth.worker.ts` + клиент: запросы в очереди, ошибка типизирована, после сбоя модель грузится заново.
- [x] Модель и wasm попадают в `dist/assets/`; `server.mjs` отдаёт `.onnx`; deploy-zip берёт весь `dist/`.
- [x] CSP не менялся; `csp.test.ts` стережёт `connect-src` и отсутствие внешних URL в коде глубины.
- [x] Сквозной тест с реальной моделью: на сцене «небо / горизонт / земля» ближнее выше дальнего.
- [x] `npm run typecheck`, `npm test`, `npm run build` проходят; в Chromium и Electron (каталог и `app.asar`) оценка работает.

## Test command

`npx vitest run src/test/depth`

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
