#!/usr/bin/env bash
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
[[ -f "$HERE/dev_db.env" ]] && source "$HERE/dev_db.env"

: "${DB_URL_SECRET:=DATABASE_URL}"
: "${PROXY_PORT:=6555}"

if ! command -v gcloud >/dev/null 2>&1; then
  # Fallback: no gcloud; do nothing but allow app to run in memory mode
  exit 0
fi

ORIG_URL="$(gcloud secrets versions access latest --secret="${DB_URL_SECRET}")"
ORIG_URL="${ORIG_URL#DATABASE_URL=}"
ORIG_URL="$(printf "%s" "$ORIG_URL" | tr -d '\r' | tr -d '\n')"

# Rewrite using Python for robust parsing (supports postgres://user@/db?host=/cloudsql/..)
REWRITTEN="$(python3 - "$PROXY_PORT" <<'PY'
import os, sys, json
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode, quote
raw = sys.stdin.read().strip()
if not raw:
  sys.exit(0)
# Accept json payloads or bare URLs
if raw and raw[0] in '{[':
  try:
    j = json.loads(raw)
    for k in ('uri','url','DATABASE_URL','connectionString'):
      if isinstance(j, dict) and k in j and j[k]:
        raw = str(j[k]).strip()
        break
  except Exception:
    pass
# Ensure scheme present
if '://' not in raw:
  raw = 'postgresql://' + raw
# Make parseable if it has @/ or @?
patched = raw.replace('@/', '@localhost/').replace('@?', '@localhost?')
u = None
try:
  u = urlparse(patched)
except Exception:
  pass
if not u:
  sys.exit(0)
# Derive db name
db = (u.path or '/').lstrip('/')
# Percent-encode user/pass exactly once
user = '' if u.username is None else quote(u.username, safe='')
pwd  = None if u.password is None else quote(u.password, safe='')
userinfo = user + ((":" + pwd) if pwd is not None else '')
if userinfo:
  userinfo += '@'
host = '127.0.0.1'
port = sys.argv[1] if len(sys.argv) > 1 else '6555'
netloc = f"{userinfo}{host}:{port}"
# Drop cloudsql socket host + ssl flags; keep others
q = dict(parse_qsl(u.query, keep_blank_values=True))
q.pop('host', None)
q['sslmode'] = 'disable'
newu = ('postgresql', netloc, '/' + db if db else '/', '', urlencode(q), '')
print(urlunparse(newu))
PY
<<< "$ORIG_URL" 2>/dev/null)"

if [[ -n "$REWRITTEN" ]]; then
  echo "export DATABASE_URL='$REWRITTEN'"
  echo "export PGSSLMODE=disable"
  echo "export REQUIRE_DB=1"
fi
