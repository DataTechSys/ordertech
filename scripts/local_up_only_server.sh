#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/.."
mkdir -p .logs

# Ensure a sane PATH for launchd (Homebrew + system)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# Base app env
export NODE_ENV=development
export PORT=3000

# DB env standardization
if [[ -f scripts/dev_db.env ]]; then
  # shellcheck source=/dev/null
  source scripts/dev_db.env
fi

# Export a localhost DATABASE_URL if possible (Secret Manager → localhost:6555)
if [[ -x scripts/dev_env_export.sh ]]; then
  eval "$(scripts/dev_env_export.sh)"
fi
# Fallback if the above produced nothing
if [[ -z "${DATABASE_URL:-}" ]]; then
  ORIG_URL=""
  if command -v gcloud >/dev/null 2>&1; then
    ORIG_URL="$(gcloud secrets versions access latest --secret="${DB_URL_SECRET:-DATABASE_URL}" 2>/dev/null || true)"
    ORIG_URL="${ORIG_URL#DATABASE_URL=}"; ORIG_URL="$(printf "%s" "$ORIG_URL" | tr -d '\r' | tr -d '\n')"
  fi
  if [[ -n "$ORIG_URL" ]]; then
    # Log only length to avoid exposing secrets
    { echo "[local_up_only_server] Fetched DB_URL_SECRET (length ${#ORIG_URL})"; } >> .logs/local_server.log 2>&1 || true
    REWRITTEN="$(python3 - "$PROXY_PORT" <<'PY'
import os, sys, json
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode, quote
raw = sys.stdin.read().strip()
if not raw:
  sys.exit(0)
if '://' not in raw:
  raw = 'postgresql://' + raw
patched = raw.replace('@/', '@localhost/').replace('@?', '@localhost?')
u = urlparse(patched)
db = (u.path or '/').lstrip('/')
user = '' if u.username is None else quote(u.username, safe='')
pwd  = None if u.password is None else quote(u.password, safe='')
userinfo = user + ((":" + pwd) if pwd is not None else '')
if userinfo:
  userinfo += '@'
host = '127.0.0.1'
port = sys.argv[1] if len(sys.argv) > 1 else '6555'
netloc = f"{userinfo}{host}:{port}"
q = dict(parse_qsl(u.query, keep_blank_values=True))
q.pop('host', None)
q['sslmode'] = 'disable'
newu = ('postgresql', netloc, '/' + db if db else '/', '', urlencode(q), '')
print(urlunparse(newu))
PY
<<< "$ORIG_URL" 2>/dev/null)"
    if [[ -n "$REWRITTEN" ]]; then
      export DATABASE_URL="$REWRITTEN"
      export PGSSLMODE=disable
      export REQUIRE_DB=1
      { echo "[local_up_only_server] DATABASE_URL rewritten OK"; } >> .logs/local_server.log 2>&1 || true
    else
      { echo "[local_up_only_server] DATABASE_URL rewrite failed"; } >> .logs/local_server.log 2>&1 || true
    fi
  fi
fi

# Start the server in foreground (launchd will keep it alive)
# Find node reliably: prefer PATH, then Homebrew prefix if available
NODE_BIN="$(command -v node || true)"
if [[ -z "${NODE_BIN}" ]]; then
  BREW_PREFIX="$(brew --prefix 2>/dev/null || true)"
  if [[ -n "${BREW_PREFIX}" && -x "${BREW_PREFIX}/bin/node" ]]; then
    NODE_BIN="${BREW_PREFIX}/bin/node"
  fi
fi
if [[ -z "${NODE_BIN}" ]]; then
  printf 'local_up_only_server.sh: node not found in PATH or Homebrew. Please install Node and retry.\n' >&2
  exit 126
fi
exec "${NODE_BIN}" server.js
