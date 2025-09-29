#!/usr/bin/env bash
# scripts/run_inventory.sh — Non-interactive, read-only DB inventory runner
# - Starts Cloud SQL Auth Proxy on 127.0.0.1:$PROXY_PORT (default 5433)
# - Fetches DATABASE_URL from Secret Manager (project smart-order-469705) without printing
# - Rewrites it to localhost:$PROXY_PORT
# - Runs read-only SQL scripts and writes outputs to ./out/
# - Shuts down the proxy
set -Eeuo pipefail

PROXY_PORT="${PROXY_PORT:-5433}"
INSTANCE="smart-order-469705:me-central1:ordertech-db"
PID_FILE="/tmp/cloud-sql-proxy.ordertech.inventory.pid"
LOG_FILE="/tmp/cloud-sql-proxy.ordertech.inventory.log"
PROJECT_ID="smart-order-469705"

cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }
need cloud-sql-proxy
need gcloud
need psql
need python3

# Stop previous proxy (if ours)
if [ -f "$PID_FILE" ]; then
  if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "[proxy] Stopping previous proxy pid $(cat "$PID_FILE")"
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    sleep 0.5 || true
  fi
  rm -f "$PID_FILE"
fi

mkdir -p out

echo "[proxy] Starting Cloud SQL Auth Proxy on 127.0.0.1:$PROXY_PORT for $INSTANCE"
cloud-sql-proxy "$INSTANCE" --address 127.0.0.1 --port "$PROXY_PORT" >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
sleep 1
if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "[proxy] Failed to start (see $LOG_FILE)" >&2
  exit 1
fi

cleanup() {
  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
}
trap cleanup EXIT

# Fetch DATABASE_URL secret (do not print)
DBURL="$(gcloud secrets versions access latest --project="$PROJECT_ID" --secret=DATABASE_URL 2>/dev/null || true)"
if [ -z "$DBURL" ]; then
  echo "DATABASE_URL secret not accessible in project $PROJECT_ID" >&2
  exit 1
fi
DBURL="$(printf "%s" "$DBURL" | tr -d '\r\n')"
DBURL="${DBURL#DATABASE_URL=}"

# Rewrite to localhost:PROXY_PORT without printing credentials
local_url=$(python3 - "$PROXY_PORT" <<'PY'
import os, sys, json
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode, quote
raw = sys.stdin.read().strip()
if not raw:
  sys.exit(1)
if raw and raw[0] in '{[':
  try:
    j = json.loads(raw)
    for k in ('uri','url','DATABASE_URL','connectionString'):
      if isinstance(j, dict) and k in j and j[k]:
        raw = str(j[k]).strip()
        break
  except Exception:
    pass
if '://' not in raw:
  raw = 'postgresql://' + raw
patched = raw.replace('@/', '@localhost/').replace('@?', '@localhost?')
u = urlparse(patched)
user = '' if u.username is None else quote(u.username, safe='')
pwd  = None if u.password is None else quote(u.password, safe='')
userinfo = user + ((":" + pwd) if pwd is not None else '')
if userinfo:
  userinfo += '@'
host = '127.0.0.1'
port = sys.argv[1] if len(sys.argv)>1 else '5432'
netloc = f"{userinfo}{host}:{port}"
q = dict(parse_qsl(u.query, keep_blank_values=True))
q.pop('host', None)
q.pop('sslmode', None)
q.pop('port', None)
# database name from path
db = (u.path or '/').lstrip('/')
newu = ('postgresql', netloc, '/' + db if db else '/', '', urlencode(q), '')
print(urlunparse(newu))
PY
<<< "$DBURL" 2>/dev/null)
export DATABASE_URL="$local_url"
# Force libpq to target the proxy host/port explicitly (belt-and-suspenders)
export PGHOST=127.0.0.1
export PGPORT="$PROXY_PORT"

# Run read-only queries (disable pager, stop on errors)
psql -X -v ON_ERROR_STOP=1 -P pager=off "$DATABASE_URL" -f scripts/sql/inventory.sql | tee out/inventory.txt
psql -X -v ON_ERROR_STOP=1 -P pager=off "$DATABASE_URL" -f scripts/sql/structural_diff.sql | tee out/structural_diff.txt
psql -X -v ON_ERROR_STOP=1 -P pager=off "$DATABASE_URL" -f scripts/sql/dependencies.sql | tee out/dependencies.txt

echo "[done] Inventory outputs written to $(pwd)/out/"
