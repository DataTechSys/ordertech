#!/usr/bin/env bash
# Stop local OrderTech server and Cloud SQL proxy
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$SCRIPT_DIR/.."

if [ -f .logs/local_server.pid ]; then
  pid=$(cat .logs/local_server.pid || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" || true
    echo "[local_down] Stopped server pid $pid"
  fi
  rm -f .logs/local_server.pid
fi

. "$SCRIPT_DIR/dev_db.sh" stop || true
