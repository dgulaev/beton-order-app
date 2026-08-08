#!/bin/bash
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/concrete-beton-app}"
cd "$APP_DIR"
mkdir -p logs
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "$(date '+%F %T') deploy start" | tee -a logs/deploy.log
git fetch origin
git checkout main
git pull --ff-only origin main

npm install
npm run build

# перезапуск Next (launchd)
launchctl kickstart -k "gui/$(id -u)/com.concrete.local-server"

echo "$(date '+%F %T') deploy done" | tee -a logs/deploy.log
