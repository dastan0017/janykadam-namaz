#!/usr/bin/env bash
# Первичная настройка сервера под Janykadam. Запускать от root на чистой
# Ubuntu 24.04:
#
#   bash deploy/bootstrap.sh
#
# Скрипт идемпотентный: повторный запуск ничего не ломает и не перетирает
# уже заполненный deploy/.env.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/janykadam}"
ENV_FILE="$REPO_DIR/deploy/.env"
COMPOSE=(docker compose -f "$REPO_DIR/deploy/docker-compose.yml" --env-file "$ENV_FILE")

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo 'Нужны права root'; exit 1; }

say 'Пакеты'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw docker.io docker-compose-v2
systemctl enable --now docker

say 'Фаервол'
# Открыты только вход по SSH и веб. База и бот портов наружу не публикуют.
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status verbose | head -12

say 'Настройки'
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$REPO_DIR/deploy/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  # Секреты генерируются здесь и никуда не уезжают.
  for key in POSTGRES_PASSWORD WEBHOOK_SECRET SESSION_SECRET; do
    value="$(openssl rand -hex 32)"
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  done
  echo "Создан $ENV_FILE с новыми секретами."
  echo 'Впишите BOT_TOKEN, BOT_USERNAME и INITIAL_ADMIN_TG_USERNAME, затем запустите скрипт снова.'
  exit 0
fi

missing=()
for key in DOMAIN BOT_USERNAME BOT_TOKEN POSTGRES_PASSWORD WEBHOOK_SECRET SESSION_SECRET; do
  grep -qE "^${key}=.+" "$ENV_FILE" || missing+=("$key")
done
if (( ${#missing[@]} )); then
  echo "Не заполнено в $ENV_FILE: ${missing[*]}"
  exit 1
fi

say 'Сборка и запуск'
"${COMPOSE[@]}" up -d --build

say 'Ожидание базы'
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T db pg_isready -U janykadam >/dev/null 2>&1; then break; fi
  sleep 2
done

say 'Миграции'
"${COMPOSE[@]}" exec -T app node dist/db/migrate.js

# Справочник городов большой: качается один раз, повторный запуск его пропускает.
if [[ "$("${COMPOSE[@]}" exec -T db psql -U janykadam -d janykadam -t -A -c 'select count(*) from geonames' 2>/dev/null || echo 0)" -lt 1000 ]]; then
  say 'Импорт городов (около 30 МБ, пара минут)'
  "${COMPOSE[@]}" exec -T app node dist/scripts/import-geonames.js
else
  say 'Города уже импортированы, пропускаю'
fi

say 'Базовые данные'
"${COMPOSE[@]}" exec -T app node dist/db/seed.js

say 'Проверка'
"${COMPOSE[@]}" ps
domain="$(grep -E '^DOMAIN=' "$ENV_FILE" | cut -d= -f2-)"
echo
echo "Локально:  $(curl -fsS http://127.0.0.1/healthz 2>/dev/null || echo 'нет ответа')"
echo "Снаружи:   https://${domain}/healthz"
echo
echo 'Если снаружи не отвечает — проверьте, что домен указывает на этот сервер,'
echo 'и посмотрите логи Caddy: docker compose ... logs web'
