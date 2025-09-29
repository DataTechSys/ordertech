#!/usr/bin/env bash
set -Eeuo pipefail

# Compute a local DATABASE_URL pointing at the Cloud SQL proxy on 127.0.0.1:6555
# Prints the URL to stdout.

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
[[ -f "$HERE/dev_db.env" ]] && source "$HERE/dev_db.env"

: "${DB_URL_SECRET:=DATABASE_URL}"
: "${PROXY_PORT:=6555}"

if ! command -v gcloud >/dev/null 2>&1; then
  exit 1
fi

ORIG_URL="$(gcloud secrets versions access latest --secret="${DB_URL_SECRET}" 2>/dev/null || true)"
ORIG_URL="${ORIG_URL#DATABASE_URL=}"
ORIG_URL="$(printf "%s" "$ORIG_URL" | tr -d '\r' | tr -d '\n')"
# Debug: print length (no secret exposure)
echo "LEN:${#ORIG_URL}" 1>&2

python3 - "$PROXY_PORT" <<'PY'
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode, quote
import os, sys
raw = sys.stdin.read().strip()
if not raw:
  sys.exit(0)
# Ensure scheme present
if '://' not in raw:
  raw = 'postgresql://' + raw
# Patch missing host (/@) to localhost for parsing
patched = raw.replace('@/', '@localhost/').replace('@?', '@localhost?')
try:
  u = urlparse(patched)
except Exception:
  sys.exit(0)
user = '' if u.username is None else quote(u.username, safe='')
pwd  = None if u.password is None else quote(u.password, safe='')
userinfo = user + ((":" + pwd) if pwd is not None else '')
if userinfo:
  userinfo += '@'
q = dict(parse_qsl(u.query, keep_blank_values=True))
q.pop('host', None)
q['sslmode'] = 'disable'
port = sys.argv[1] if len(sys.argv) > 1 else '6555'
netloc = f"{userinfo}127.0.0.1:{port}"
path = '/' + (u.path or '/').lstrip('/')
print(urlunparse(('postgresql', netloc, path, '', urlencode(q), '')))
PY
<<< "$ORIG_URL"
