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

Всё дальше — по SSH, от root.

```bash
apt update && apt install -y docker.io docker-compose-v2 git ufw
```

Открыть только нужное:

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

Забрать код:

```bash
git clone <адрес репозитория> /opt/janykadam && cd /opt/janykadam
```

Настройки:

```bash
cp deploy/.env.example deploy/.env
```

Заполнить `deploy/.env`. Три секрета генерируются так, каждый своей командой:

```bash
openssl rand -hex 32
```

Поднять:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Первый раз — миграции, справочник городов и базовые данные:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec app node dist/db/migrate.js
```

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec app node dist/scripts/import-geonames.js
```

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec app node dist/db/seed.js
```

Импорт городов скачивает около 30 МБ и занимает пару минут: 171 тысяча строк.

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

Их никто не делает автоматически. Минимум — ночной дамп на тот же диск плюс
копия наружу:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db pg_dump -U janykadam janykadam | gzip > /opt/backups/janykadam-$(date +%F).sql.gz
```

Поставьте это в cron и не забудьте уносить копии с сервера: диск у VPS один, и
теряется он вместе с машиной.

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
