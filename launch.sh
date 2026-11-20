#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

if command -v python3 >/dev/null 2>&1; then
  exec python3 "$DIR/server.py" "$@"
elif command -v node >/dev/null 2>&1; then
  exec node "$DIR/server.mjs" "$@"
else
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$DIR/index.html"
  elif command -v open >/dev/null 2>&1; then
    open "$DIR/index.html"
  else
    echo "Open $DIR/index.html in your browser."
  fi
fi
