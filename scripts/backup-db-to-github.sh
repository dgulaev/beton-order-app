#!/bin/bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/concrete-beton-app}"
BACKUP_DIR="$APP_DIR/db-backups"
LOG="$APP_DIR/logs/db-backup-github.log"
# URL локального Supabase Postgres (из supabase status; пароль по умолчанию postgres)
DB_URL="${LOCAL_SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
PG_DUMP="${PG_DUMP_BIN:-/opt/homebrew/opt/libpq/bin/pg_dump}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

mkdir -p "$BACKUP_DIR" "$(dirname "$LOG")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

{
  echo "==== $(date '+%F %T') start ===="

  # Docker/БД должны быть живы
  if ! docker info >/dev/null 2>&1; then
    echo "ERROR: docker not ready"; exit 1
  fi

  TIMESTAMP=$(date +'%Y-%m-%d')
  FILE="$BACKUP_DIR/backup-${TIMESTAMP}.sql.gz"
  TMP="${FILE}.partial"

  # Тот же формат, что облачный Action: plain SQL, --no-owner, ACL сохраняем
  set -o pipefail
  "$PG_DUMP" "$DB_URL" --no-owner --format=plain | gzip > "$TMP"
  SIZE=$(stat -f%z "$TMP" 2>/dev/null || stat -c%s "$TMP")
  if [ "$SIZE" -lt 1024 ]; then
    echo "ERROR: dump too small ($SIZE bytes)"; rm -f "$TMP"; exit 1
  fi
  mv "$TMP" "$FILE"
  echo "created $FILE ($SIZE bytes)"

  # Ротация локальных файлов
  find "$BACKUP_DIR" -name 'backup-*.sql.gz' -mtime +"$KEEP_DAYS" -delete

  cd "$APP_DIR"
  git pull --ff-only || true

  git add db-backups/backup-*.sql.gz
  # убрать из индекса удалённые старые дампы
  git add -u db-backups/

  if git diff --cached --quiet; then
    echo "no changes to commit"
  else
    git -c user.name="db-backup-bot" -c user.email="db-backup-bot@local" \
      commit -m "Бэкап локальной БД ${TIMESTAMP} — $(date '+%d.%m.%Y %H:%M')"
    git push origin HEAD
    echo "pushed to GitHub"
  fi

  echo "==== $(date '+%F %T') done ===="
} >> "$LOG" 2>&1
