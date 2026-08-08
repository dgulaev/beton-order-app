#!/bin/bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/concrete-beton-app}"
LOG_DIR="$APP_DIR/logs"
mkdir -p "$LOG_DIR"

export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$APP_DIR"

# 1) Ждём Docker Engine (до ~3 мин)
for i in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    echo "$(date '+%F %T') docker ready" >> "$LOG_DIR/autostart.log"
    break
  fi
  sleep 3
  if [ "$i" -eq 60 ]; then
    echo "$(date '+%F %T') docker NOT ready" >> "$LOG_DIR/autostart.log"
    exit 1
  fi
done

# 2) Поднимаем локальный Supabase (идемпотентно)
npx supabase start >> "$LOG_DIR/supabase.log" 2>&1

# 3) Ждём API Supabase
for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:54321/rest/v1/" >/dev/null 2>&1 \
     || curl -sf "http://127.0.0.1:54321" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# 4) Next.js prod (тот же npm run start)
# KeepAlive в launchd перезапустит процесс, если упадёт
exec npm run start >> "$LOG_DIR/next.log" 2>&1
