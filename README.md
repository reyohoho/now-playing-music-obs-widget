# Now Playing

Chrome Extension для определения текущего трека/видео из нескольких источников, управления воспроизведением и интеграции с OBS/Twitch.

## Требования

- Chromium-браузер с поддержкой MV3 (минимум Chrome `116`).
- Node.js `>= 20` и npm.

## Что умеет

- Определять текущий трек: `title`, `artist`, `duration`, `position`, `progress`, `cover`.
- Показывать активные источники в popup и выбирать главный источник вручную.
- Управлять воспроизведением: `play/pause`, `next/previous`, `seek`, `volume`, `mute`.
- Отправлять данные в OBS в `Text Source` по шаблону.
- Отправлять данные в OBS в `Browser Source` через `obs-browser` event (`nowplaying:update` по умолчанию).
- Управлять воспроизведением из Twitch-чата через Command Router.
- Публиковать announce «now playing» в Twitch-чат.

## Источники

Расширение поддерживает встроенные источники и позволяет добавлять свои через сохранённые wrapper-источники (host/path + селекторы управления) прямо из настроек.

## Быстрый старт (пользователь)

1. Установите расширение:
Для релиза/ручной установки: `npm run build`, затем загрузите как unpacked папку `dist` в `chrome://extensions`.
Для разработки с HMR: `npm run dev`, затем загрузите как unpacked папку `dev`.

2. Откройте `Now Playing` popup и `Настройки`.

3. Включите `Вкл` в popup (глобальный переключатель сервиса).

4. Включите нужные интеграции `OBS`/`Twitch` и заполните их настройки.

## Настройка OBS

1. В OBS включите WebSocket сервер (`Tools -> WebSocket Server Settings`).

2. В настройках расширения (`OBS`):
Включите `OBS`, укажите `Host`, `Port`, `Password`, затем нажмите `Переподключить OBS`.

3. Режим `Вариант отображения: Текстовый источник`:
Укажите `Text Source name` и настройте `Шаблон текста`.

4. Режим `Вариант отображения: Встроенный браузер`:
Оставьте включенным `Отправлять событие obs-browser`, при необходимости поменяйте `Имя события`, и в OBS Browser Source используйте локальный файл `dist/src/widget/index.html`.

Доп. параметры URL виджета (опционально):
- `hideCover=1` — скрыть обложку.
- `seekWidth=240px` или `seekWidth=35%` — ширина seek/progress полоски.

Пример:
- `dist/src/widget/index.html?hideCover=1&seekWidth=240px`

## Настройка Twitch

1. Создайте Twitch App и получите `Client ID`.

2. Добавьте OAuth Redirect URL для вашего Extension ID:
- `https://<EXTENSION_ID>.chromiumapp.org/`
- `https://<EXTENSION_ID>.chromiumapp.org/twitch`
- `https://<EXTENSION_ID>.chromiumapp.org/twitch/`

3. В настройках расширения (`Twitch`):
Включите интеграцию Twitch, укажите `Канал` и `Client ID`, нажмите `OAuth авторизация`, затем при необходимости включите `Управление из Twitch` и/или `Анонсы в чат`.

## Команды Twitch

- Формат: `<trigger> <alias> [arg]`
- Trigger по умолчанию: `!ww`
- Если отправить только `!ww`, расширение выполнит `np` (покажет текущий now playing в чат) с теми же правилами доступа и лимитами, что у команды `np`.
- После trigger можно писать как с пробелом, так и вплотную: `!ww pause` и `!wwpause`.

Примеры:
- `!ww pause`
- `!ww play`
- `!ww next`
- `!ww previous`
- `!ww vol 30`
- `!ww seek 1:23`
- `!ww np`

## Частые проблемы

- Popup показывает ошибку связи с background:
Перезагрузите расширение в `chrome://extensions` и убедитесь, что загружена правильная папка: `dev` для dev, `dist` для build.

- OBS не подключается:
Проверьте `Host/Port/Password` и что WebSocket сервер OBS включен.

- OAuth Twitch не открывается:
Проверьте `Client ID` и что redirect URL добавлены в Twitch App ровно как выше.

## Для разработчика

### Технологии

- MV3
- Vite + CRXJS
- Preact
- Radix UI (`@radix-ui/themes` + primitives)
- Vitest

### Команды

- `npm run dev` — dev server + HMR, выход в `dev`.
- `npm run build` — production build, выход в `dist`.
- `npm test` — прогон тестов.
- `npm run test:watch` — watch-режим тестов.

### Архитектура

- `src/sources` — source modules (provider metadata, extract, source-specific control/runtime).
- `src/content/contentScript.js` — детекция на странице, отправка `source:update`/`source:remove`.
- `src/background/serviceWorker.js` — runtime state, выбор активного источника, OBS/Twitch sync.
- `src/popup` — управление в реальном времени.
- `src/options` — конфигурация и диагностика.
- `src/widget` — Browser Source виджет для OBS.

### Структура проекта

- `src/background` — OBS/Twitch клиенты и orchestration.
- `src/content` — bridges и контент-логика.
- `src/core` — normalize/resolver/template/session logic.
- `src/sources/providers/*/module.js` — отдельный модуль на источник.
- `src/shared` — storage, i18n, messages, contracts.
- `tests` — unit/integration smoke.

### Как добавить новый источник

1. Создайте `src/sources/providers/<source>/module.js`.

2. Опишите `meta`:
`id`, `label`, `hosts`, `controls`, `controlRoot`, `controlActionKeywords`.

3. Реализуйте:
`extract(context)`.
При необходимости `control.execute(action, value, context)`.
При необходимости `runtime.init(context, onInvalidate)`.

4. Подключите модуль в `src/sources/index.js`.

5. Проверьте popup/controls/priority и добавьте минимальные тесты.

### i18n

- Локали: `src/shared/i18n/locales/ru.json`, `src/shared/i18n/locales/en.json`.
- Для пользовательских строк используйте `t(...)`.

### Примечания

- Основной подход в отладке: сначала искать root cause, а не наращивать fallback-костыли.
- `debugMode` по умолчанию выключен.
