# Манифест требований

Источник: `brief.md`. Строку из этого списка может снять только пользователь.

| ID | Из брифа (дословно) | Статус | Основание | Где |
|----|---------------------|--------|-----------|-----|
| R01 | «Import and analyze reference 3MF» | in-ticket | Отчёт показывает структуру, размер, высоты, цвета и swap schedule reference-файла. | T01, T03 |
| R02i | *(подразумевается)* загрузка локального файла `.3mf` через существующий интерфейс | in-ticket | Добавляется отдельный локальный 3MF input/dropzone; исходное изображение workflow не ломается. | T03 |
| R03i | *(подразумевается)* разбор структуры 3MF без сервера и аккаунтов | in-ticket | Поддерживаются HueForge/Bambu-style 3MF и exports приложения: ZIP package parts, model XML, custom per-layer metadata, filament settings. | T01 |
| R04i | *(подразумевается)* понятное состояние ошибки для повреждённого или неподдерживаемого 3MF | in-ticket | Нельзя оставлять пользователя без объяснения при невалидном архиве/XML. | T01, T03 |
| R05i | *(подразумевается)* результат анализа должен быть сопоставим с текущими STL/3MF настройками | in-ticket | Анализ read-only; отдельная кнопка переносит распознанные цвета, layer height, размеры, base/max height и swap schedule к текущему изображению без автоматической замены. | T02, T03 |
| R06i | *(подразумевается)* приложение должно оставаться работоспособным при больших файлах | in-ticket | Анализ выполняется в браузере с ограничением размера и сообщением о превышении. | T01, T03 |
| R07i | *(подразумевается)* существующий генератор 3MF не должен быть сломан | in-ticket | Регрессия покрывается typecheck, тестами и production build. | T01, T02, T03 |
| G01 | «Analyze first, then offer “Apply to editor” (Recommended)» | in-ticket | Анализ read-only; применение только явной кнопкой. | T03 |
| G02 | «HueForge/Bambu-style files plus this app’s exports (Recommended)» | in-ticket | Парсим стандартные model parts и известные Bambu/HueForge metadata; optional parts дают partial report. | T01 |
| G03 | «Colors, layer height, dimensions, base/max height, and swap schedule (Recommended)» | in-ticket | Переносим все найденные и представимые поля; неизвестные поля явно помечаем недоступными, не выдумываем. | T02 |
