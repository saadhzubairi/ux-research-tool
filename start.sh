#!/usr/bin/env bash
# Start the full ismap dev stack:
#   1. build @gazekit/shared (extension + server types depend on its dist)
#   2. build the extension  -> load/reload packages/extension/dist in Chrome
#   3. run backend (tsx watch) + frontend (vite) together
# Ctrl+C stops both dev servers.
set -euo pipefail
cd "$(dirname "$0")"

# --- Pre-flight: refuse to start on top of an already-running stack --------
HTTP_PORT=$(grep -E '^HTTP_PORT=' packages/web/server/.env 2>/dev/null | cut -d= -f2 || true)
WS_PORT=$(grep -E '^WS_PORT=' packages/web/server/.env 2>/dev/null | cut -d= -f2 || true)
VITE_PORT=5173
busy=0
for port in "${HTTP_PORT:-4444}" "${WS_PORT:-8765}" "$VITE_PORT"; do
  if lsof -iTCP:"$port" -sTCP:LISTEN -Pn >/dev/null 2>&1; then
    echo "✗ Port $port is already in use:"
    lsof -iTCP:"$port" -sTCP:LISTEN -Pn | tail -n +2 | awk '{printf "    %s (pid %s)\n", $1, $2}'
    busy=1
  fi
done
if [ "$busy" -eq 1 ]; then
  echo "The dev stack looks like it's already running — stop it first (or kill the pids above)."
  exit 1
fi

echo "▸ [1/3] Building shared package..."
npm run build -w @gazekit/shared

echo "▸ [2/3] Building extension..."
npm run build -w @gazekit/extension
echo "  ✓ Extension built — reload it at chrome://extensions (packages/extension/dist)"

echo "▸ [3/3] Starting backend + frontend (Ctrl+C stops both)..."
trap 'kill 0' EXIT INT TERM
npm run dev -w packages/web/server &
npm run dev -w packages/web/client &
wait
