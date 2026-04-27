# ya-music-obs-widget — backend

Тонкий Go-бэкенд, который принимает «now playing» строки от расширения по
HTTP и транслирует их подключённым оверлеям (страницам, открытым OBS как
Browser Source) по WebSocket.

## Архитектура

```
Extension (chrome)                Backend (Go)               OBS Browser Source
─────────────────────             ────────────               ──────────────────
POST /api/publish/<id>  ──────▶   in-memory room    ──────▶  WebSocket /ws/sub/<id>
GET  /api/status/<id>   ◀──────   {subscribers:N}
                                  auth: SHA-256(key)
                                  persist: /data/auth.json
```

- Расширение знает пару `(id, key)`. Первый `POST /api/publish/:id`
  регистрирует хэш ключа (TOFU). Последующие запросы должны предъявить тот
  же ключ через заголовок `Authorization: Bearer <key>`.
- OBS (и любой другой клиент) открывает `/overlay/<id>` — HTML-страница
  внутри держит WebSocket и рисует последний трек.
- Расширение периодически опрашивает `/api/status/<id>` и отправляет
  `publish` только если `subscribers > 0`, чтобы зря не жечь трафик.

## HTTP API

| Метод | Путь                       | Назначение                                                     |
| ----- | -------------------------- | -------------------------------------------------------------- |
| GET   | `/healthz`                 | Пинг / uptime.                                                 |
| GET   | `/overlay/{id}`            | HTML-страница для OBS — вид настраивается из расширения.        |
| GET   | `/api/status/{id}`         | `{"id":"...", "subscribers":N}`                                 |
| POST  | `/api/publish/{id}`        | `{"text","providerId","settings?","settingsOnly?"}` + Bearer.   |
| GET   | `/ws/sub/{id}`             | WebSocket для оверлея: `{type:"song"}` и `{type:"settings"}`.   |

Раньше были две темы (`?theme=minimal|card`) — теперь один оверлей, внешний
вид (фон, цвета, шрифт, размер, иконка провайдера) задаётся в настройках
расширения и транслируется подключённым оверлеям мгновенно через
`{type:"settings"}`.

## Конфигурация через env

| Переменная | По умолчанию | Описание                                            |
| ---------- | ------------ | --------------------------------------------------- |
| `ADDR`     | `:8787`      | Интерфейс/порт HTTP-сервера.                         |
| `DATA_DIR` | `/data`      | Куда складывать `auth.json` (хэши ключей по `id`).   |

## Запуск

```bash
cd backend
go run .            # локально
# или
docker compose up --build -d
```

После запуска:

```bash
curl http://localhost:8787/healthz
curl http://localhost:8787/api/status/<любой-id>
```

## Деплой

- Поднимите контейнер, затем поставьте перед ним reverse-proxy (nginx,
  caddy) c TLS. OBS корректно работает и с `ws://`, но для внешней ссылки
  удобнее `https://`/`wss://`.
- Подкинутый `/data` volume содержит `auth.json` — единственное состояние,
  которое переживёт рестарт; без него расширение будет регистрировать ключ
  заново при каждом рестарте (и первый `publish` после рестарта всегда
  «возьмёт» свежий ключ благодаря TOFU, но лучше оставить volume).

## Что поменять в расширении

В файле `../background.js` есть константа `BACKEND_URL`. Замените на ваш
боевой URL (например, `https://ya-music.example.com`) и добавьте ту же
origin в `../manifest.json` → `host_permissions`.
