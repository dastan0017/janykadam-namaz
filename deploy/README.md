# Развёртывание

Панель, API и база на одном сервере. Caddy отдаёт панель и проксирует `/api`,
`/telegram` и `/healthz` в бота, сертификат берёт сам.

Всё на одном домене не ради экономии: кука сессии `jk_admin` ставится с
`SameSite=Lax`, а бесплатные поддомены вроде `*.duckdns.org` лежат в Public
Suffix List — для браузера `panel.duckdns.org` и `api.duckdns.org` это разные
сайты, и кука между ними не ходит. Один origin снимает и этот вопрос, и CORS.

## Что нужно до начала

Эти шаги делает человек — здесь регистрация и оплата.

1. **VPS.** InterServer, один слайс: 1 ядро, 2 ГБ, 40 ГБ SSD, $3/мес. Образ —
   Ubuntu 24.04. Для начала хватит одного слайса; если база разрастётся, два.
2. **Домен.** Уже заведён: `janykadam.duckdns.org` на
   [duckdns.org](https://www.duckdns.org), аккаунт владельца проекта.
   Когда появится VPS — вписать его адрес в поле `current ip` и нажать
   `update ip`. TTL записи 60 секунд, так что новый адрес расходится за минуту.
   Токен DuckDNS в развёртывании не нужен: у VPS адрес постоянный, и
   обновлять запись автоматически незачем.
3. **Бот.** В BotFather: `/newbot` — получить токен, затем `/setdomain` и ваш
   домен. **Без `/setdomain` виджет входа в панель не заработает**: Telegram
   отказывается отдавать данные на незарегистрированный домен.

## Сервер

Всё дальше — по SSH, от root. Забрать код:

```bash
apt-get update -qq && apt-get install -y -qq git && git clone <адрес репозитория> /opt/janykadam
```

Дальше всё делает [`bootstrap.sh`](bootstrap.sh) — он ставит пакеты, закрывает
фаервол, генерирует секреты, поднимает стенд, применяет миграции, импортирует
города и выполняет сид. Скрипт идемпотентный: повторный запуск ничего не ломает.

```bash
bash /opt/janykadam/deploy/bootstrap.sh
```

Первый запуск создаст `deploy/.env` с новыми секретами и остановится: впишите
`BOT_TOKEN`, `BOT_USERNAME` и `INITIAL_ADMIN_TG_USERNAME`, затем запустите
скрипт снова. Импорт городов скачивает около 30 МБ и занимает пару минут:
171 тысяча строк.

Если хочется по шагам, руками:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec app node dist/db/migrate.js
```

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec app node dist/scripts/import-geonames.js
```

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec app node dist/db/seed.js
```

## Проверить

```bash
curl -s https://ваш-домен/healthz
```

Должно прийти `{"ok":true,"db":"up","queue":"up"}`. Дальше откройте домен в
браузере — это панель, вход через Telegram под тем username, что указан в
`INITIAL_ADMIN_TG_USERNAME`.

Вебхук бот регистрирует сам при старте. Проверить, что Telegram о нём знает:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs app | grep -i вебхук
```

## Обновление

```bash
cd /opt/janykadam && git pull && docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Если в обновлении были миграции — применить их тем же `node dist/db/migrate.js`.

## Резервные копии

`bootstrap.sh` ставит [`backup.sh`](backup.sh) в `/usr/local/bin/janykadam-backup`
и заводит cron: каждую ночь в 03:30 UTC дамп базы ложится в
`/var/backups/janykadam`, хранится 14 дней. Скрипт отказывается подменять
готовую копию оборванным дампом и ругается, если дамп подозрительно мал.

Сделать копию прямо сейчас:

```bash
/usr/local/bin/janykadam-backup
```

**Копии лежат на том же диске, что и база.** Это спасает от испорченных данных,
но не от потери машины — диск у VPS один. Уносите копии наружу.

Проверить, что копия действительно восстанавливается (делать хотя бы изредка —
непроверенная копия не копия):

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db psql -U janykadam -d postgres -c 'create database restore_test'
```

```bash
gunzip -c /var/backups/janykadam/ИМЯ.sql.gz | docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db psql -U janykadam -d restore_test
```

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db psql -U janykadam -d restore_test -c 'select count(*) from geonames'
```

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db psql -U janykadam -d postgres -c 'drop database restore_test'
```

## Что открыто наружу

Только 80 и 443. База и бот порты не публикуют — к ним ходят внутри сети
compose. Swagger на `/api/docs` в проде выключен: он открыт без входа и
показывал бы всю поверхность админ-API. Включается `ENABLE_DOCS=true`, если
понадобится.

## Если что-то не так

**Caddy не получил сертификат.** Домен должен указывать на этот сервер, а 80 и
443 быть открыты. Посмотрите `docker compose ... logs web`.

**Виджет входа не появился.** В BotFather не задан `/setdomain` для этого
домена, либо в `deploy/.env` не тот `BOT_USERNAME`.

**Вход проходит, но панель пустая и просит войти снова.** Кука не доезжает:
проверьте, что открываете именно `https://`, а не `http://` — в проде кука
ставится с флагом `Secure`.

**Бот не отвечает.** `logs app` покажет, зарегистрировался ли вебхук. Частая
причина — `PUBLIC_URL` не совпадает с доменом, на котором висит Caddy.
