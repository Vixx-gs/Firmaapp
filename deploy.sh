#!/usr/bin/env bash
# Despliega la última versión de main en este servidor Plesk.
# Uso: ./deploy.sh
set -euo pipefail

APP_DIR="/var/www/vhosts/gesticotrans.app/firma.gesticotrans.app"
NODE_BIN="/opt/plesk/node/24/bin/node"
NPM_BIN="/opt/plesk/node/24/bin/npm"
OWNER="root-gesticoapp:psacln"

cd "$APP_DIR"

echo "==> git pull"
git pull origin main

echo "==> npm install"
"$NPM_BIN" install

echo "==> npm run build"
"$NPM_BIN" run build

echo "==> corrigiendo permisos"
chown -R "$OWNER" .

echo "==> reiniciando la app (Passenger)"
mkdir -p tmp
touch tmp/restart.txt

echo "==> listo"
