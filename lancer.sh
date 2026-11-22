#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVE_DIR="$SCRIPT_DIR"

if [[ -f "$SCRIPT_DIR/dist/index.html" ]]; then
  SERVE_DIR="$SCRIPT_DIR/dist"
fi

if command -v python3 >/dev/null 2>&1; then
  PY_CMD="python3"
elif command -v python >/dev/null 2>&1; then
  PY_CMD="python"
else
  echo "[Erreur] Python 3 est requis pour démarrer le serveur local." >&2
  exit 1
fi

echo "=================================================="
echo "  FolioCours - Serveur local PWA (port 8000)"
echo "=================================================="
echo "Dossier servi : $SERVE_DIR"
echo "URL : http://localhost:8000"

(
  sleep 1
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:8000" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "http://localhost:8000" >/dev/null 2>&1 || true
  fi
) &

exec "$PY_CMD" -m http.server 8000 --directory "$SERVE_DIR"
