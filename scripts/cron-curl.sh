#!/usr/bin/env bash
# Вызов cron-эндпоинта локального Next.js (для macOS crontab / ручной проверки).
#
# Использование:
#   ./scripts/cron-curl.sh scout-sync
#   ./scripts/cron-curl.sh dismiss-notifications
#
# Нужны: CRON_SECRET в окружении или в .env.local
# Опционально: CRON_BASE_URL (по умолчанию http://127.0.0.1:3000)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

JOB="${1:-}"
if [[ -z "$JOB" ]]; then
  echo "usage: $0 <cron-path-suffix>" >&2
  echo "  example: $0 scout-sync" >&2
  exit 1
fi

if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a
  # Берём только простые KEY=VALUE без export
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      val="${val%\"}"
      val="${val#\"}"
      val="${val%\'}"
      val="${val#\'}"
      export "$key=$val"
    fi
  done < .env.local
  set +a
fi

SECRET="${CRON_SECRET:-}"
BASE="${CRON_BASE_URL:-http://127.0.0.1:3000}"

if [[ -z "$SECRET" ]]; then
  echo "CRON_SECRET не задан (.env.local или env)" >&2
  exit 1
fi

URL="$BASE/api/cron/$JOB"
echo "[cron-curl] GET $URL"
curl -sS -H "Authorization: Bearer $SECRET" "$URL"
echo
