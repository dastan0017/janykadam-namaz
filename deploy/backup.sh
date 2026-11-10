#!/usr/bin/env bash
# Ночная резервная копия базы. Ставится в cron скриптом bootstrap.sh.
#
# Копия пишется на тот же диск, что и база, — это защищает от испорченных
# данных, но НЕ от потери машины. Копии нужно уносить с сервера; как именно,
# зависит от того, куда вы согласны их складывать.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/janykadam}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/janykadam}"
KEEP_DAYS="${KEEP_DAYS:-14}"

COMPOSE=(docker compose -f "$REPO_DIR/deploy/docker-compose.yml" --env-file "$REPO_DIR/deploy/.env")
stamp="$(date -u +%Y-%m-%d_%H%M)"
target="$BACKUP_DIR/janykadam-${stamp}.sql.gz"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Пишем во временный файл и переименовываем: оборванный дамп не должен
# остаться под именем готовой копии и выглядеть пригодным для восстановления.
tmp="$(mktemp "$BACKUP_DIR/.in-progress.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

if ! "${COMPOSE[@]}" exec -T db pg_dump -U janykadam --clean --if-exists janykadam | gzip -9 > "$tmp"; then
  echo "$(date -u +%FT%TZ) ОШИБКА: pg_dump не выполнился" >&2
  exit 1
fi

# Пустой или подозрительно маленький дамп — тоже отказ.
size=$(stat -c %s "$tmp")
if (( size < 10000 )); then
  echo "$(date -u +%FT%TZ) ОШИБКА: дамп всего $size байт, это не похоже на правду" >&2
  exit 1
fi

mv "$tmp" "$target"
trap - EXIT
chmod 600 "$target"

# Чистим старые.
find "$BACKUP_DIR" -name 'janykadam-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -delete

count=$(find "$BACKUP_DIR" -name 'janykadam-*.sql.gz' -type f | wc -l)
echo "$(date -u +%FT%TZ) копия готова: $target ($(numfmt --to=iec "$size")), всего копий: $count"
