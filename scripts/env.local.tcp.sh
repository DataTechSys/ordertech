#!/usr/bin/env bash
# Local DB environment bootstrap (TCP proxy) for OrderTech.
# - Uses Cloud SQL Auth Proxy on 127.0.0.1:$PROXY_PORT
# - Loads DB user/db from scripts/dev_db.env and password from Secret Manager (DB_PASSWORD_SECRET)
# - Does NOT print secrets.
#
# Usage:
#   . scripts/env.local.tcp.sh
#   PORT=3000 npm start

set -euo pipefail

# Load per-developer config if present
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/dev_db.env"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a || true

PROXY_PORT="${PROXY_PORT:-6555}"
export PGHOST="127.0.0.1"
export PGPORT="$PROXY_PORT"
export PGUSER="${DB_USER:-ordertech}"
export PGDATABASE="${DB_NAME:-ordertech}"
# Pull DB password from Secret Manager; do not echo
if command -v gcloud >/dev/null 2>&1; then
  _sec_name="${DB_PASSWORD_SECRET:-DB_PASSWORD}"
  _pwd="$(gcloud secrets versions access latest --secret="${_sec_name}" 2>/dev/null || true)"
  if [ -n "${_pwd}" ]; then export PGPASSWORD="${_pwd}"; fi
fi
# Gate features that require DB
export REQUIRE_DB=1