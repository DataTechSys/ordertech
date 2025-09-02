#!/usr/bin/env bash
# Cloud SQL local dev helper for OrderTech
# Usage (recommended): source this script in your shell so env vars persist
#   . scripts/dev_db.sh help
#   . scripts/dev_db.sh start   # starts proxy and sets env (DATABASE_URL, REQUIRE_DB)
#   . scripts/dev_db.sh stop    # stops proxy and unsets env
#   . scripts/dev_db.sh status  # shows proxy status and current DB URL
#
# You can also create scripts/dev_db.env (copy from .env.example) to hold your
# instance/user/db/secret names and this script will source it.

set -euo pipefail

# Detect if we are sourced (so we can export to current shell)
# shellcheck disable=SC2296
__DT_SOURCED=0
if [ -n "${ZSH_EVAL_CONTEXT:-}" ]; then
  case $ZSH_EVAL_CONTEXT in *:file) __DT_SOURCED=1;; esac
elif [ -n "${BASH_SOURCE:-}" ] && [ "${BASH_SOURCE[0]}" != "$0" ]; then
  __DT_SOURCED=1
fi

# Load optional per-developer config (resolve script dir when sourced)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/dev_db.env"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a || true

# Defaults (override via env or scripts/dev_db.env)
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || echo "")}" || true
REGION="${REGION:-europe-west1}"
# Either provide CONNECTION_NAME directly OR INSTANCE_NAME to build it as PROJECT:REGION:INSTANCE
CONNECTION_NAME="${CONNECTION_NAME:-}"
INSTANCE_NAME="${INSTANCE_NAME:-}"  # e.g. smart-order-pg
PROXY_PORT="${PROXY_PORT:-5432}"

# DB credentials (db user/name and a Secret Manager secret holding the password)
# OR provide DB_URL_SECRET to fetch the full DATABASE_URL and we will rewrite host to 127.0.0.1:PORT
DB_USER="${DB_USER:-}"
DB_NAME="${DB_NAME:-}"
DB_PASSWORD_SECRET="${DB_PASSWORD_SECRET:-}"
DB_URL_SECRET="${DB_URL_SECRET:-}"

# Internal
PID_DIR="/tmp"
PID_FILE="$PID_DIR/cloud-sql-proxy.ordertech.pid"

_die(){ echo "[dev_db] $*" >&2; return 1; }
_info(){ echo "[dev_db] $*"; }

_need_sourced(){
  if [ "$__DT_SOURCED" -ne 1 ]; then
    _die "Please source this script so env vars persist: . scripts/dev_db.sh $1";
  fi
}

_resolve_connection(){
  if [ -n "$CONNECTION_NAME" ]; then
    echo "$CONNECTION_NAME"; return 0;
  fi
  if [ -z "$PROJECT_ID" ] || [ -z "$REGION" ] || [ -z "$INSTANCE_NAME" ]; then
    _die "Set CONNECTION_NAME or PROJECT_ID+REGION+INSTANCE_NAME (see scripts/dev_db.env.example)";
  fi
  echo "${PROJECT_ID}:${REGION}:${INSTANCE_NAME}"
}

_is_running(){
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

_start_proxy(){
  local conn
  conn="$(_resolve_connection)" || return 1
  command -v cloud-sql-proxy >/dev/null 2>&1 || _die "cloud-sql-proxy not found. Install: brew install cloud-sql-proxy"
  if _is_running; then
    _info "Proxy already running (pid $(cat "$PID_FILE"))"
    return 0
  fi
  _info "Starting Cloud SQL Auth Proxy on 127.0.0.1:$PROXY_PORT for $conn"
  # shellcheck disable=SC2086
  cloud-sql-proxy "$conn" --port "$PROXY_PORT" 1>/dev/null 2>&1 &
  echo $! > "$PID_FILE"
  sleep 0.5
  if ! _is_running; then
    _die "Failed to start cloud-sql-proxy"
  fi
}

_export_env(){
  _need_sourced "start"
  if [ -n "$DB_URL_SECRET" ]; then
    # Fetch full DATABASE_URL from Secret Manager, rewrite host:port to localhost:PROXY_PORT
    local raw_url
    raw_url="$(gcloud secrets versions access latest --secret="$DB_URL_SECRET" 2>/dev/null || true)"
    [ -n "$raw_url" ] || _die "Could not fetch DATABASE_URL from Secret Manager: $DB_URL_SECRET"
    # Parse url safely with node (available in this repo)
    local local_url
    local_url=$(node -e 'try{const u=new URL(process.env.RAW_URL);u.hostname="127.0.0.1";u.port=String(process.env.PROXY_PORT||5432);u.protocol="postgres:";console.log(u.toString())}catch(e){process.exit(1)}' RAW_URL="$raw_url" PROXY_PORT="$PROXY_PORT" || true)
    [ -n "$local_url" ] || _die "Failed to rewrite DATABASE_URL for localhost"
    export DATABASE_URL="$local_url"
    export REQUIRE_DB=1
    _info "Env set via DB_URL_SECRET: REQUIRE_DB=1 and DATABASE_URL → 127.0.0.1:${PROXY_PORT}"
    return 0
  fi
  if [ -z "$DB_USER" ] || [ -z "$DB_NAME" ] || [ -z "$DB_PASSWORD_SECRET" ]; then
    _die "Set DB_URL_SECRET or DB_USER, DB_NAME, DB_PASSWORD_SECRET (see scripts/dev_db.env.example)"
  fi
  # Fetch password from Secret Manager each time to avoid printing secrets
  local pass
  pass="$(gcloud secrets versions access latest --secret="$DB_PASSWORD_SECRET" 2>/dev/null || true)"
  if [ -z "$pass" ]; then
    _die "Could not fetch password from Secret Manager: $DB_PASSWORD_SECRET"
  fi
  export DATABASE_URL="postgres://${DB_USER}:${pass}@127.0.0.1:${PROXY_PORT}/${DB_NAME}"
  export REQUIRE_DB=1
  _info "Env set: REQUIRE_DB=1 and DATABASE_URL for 127.0.0.1:${PROXY_PORT}/${DB_NAME}"
}

_unset_env(){
  _need_sourced "stop"
  unset DATABASE_URL REQUIRE_DB || true
  _info "Env unset: DATABASE_URL, REQUIRE_DB"
}

stop(){
  if _is_running; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
    _info "Proxy stopped"
  else
    _info "Proxy not running"
  fi
}

start(){ _start_proxy && _export_env; }
status(){
  if _is_running; then _info "Proxy: running (pid $(cat "$PID_FILE"))"; else _info "Proxy: stopped"; fi
  if [ -n "${DATABASE_URL:-}" ]; then _info "DATABASE_URL is set"; else _info "DATABASE_URL not set"; fi
  if [ -n "${REQUIRE_DB:-}" ]; then _info "REQUIRE_DB=$REQUIRE_DB"; fi
}

help(){
  cat <<'EOF'
OrderTech dev DB helper

USAGE (source this script):
  . scripts/dev_db.sh help     # this help
  . scripts/dev_db.sh start    # start proxy and export env (DATABASE_URL, REQUIRE_DB)
  . scripts/dev_db.sh stop     # stop proxy and unset env
  . scripts/dev_db.sh status   # show proxy/env status

CONFIGURE
  Create scripts/dev_db.env with the following variables:
    PROJECT_ID=smart-order-469705
    REGION=europe-west1
    INSTANCE_NAME=smart-order-pg
    # or set CONNECTION_NAME=smart-order-469705:europe-west1:smart-order-pg
    PROXY_PORT=5432
    DB_USER={{DB_USER}}
    DB_NAME={{DB_NAME}}
    DB_PASSWORD_SECRET={{DB_PASSWORD_SECRET_NAME}}

NOTES
  - Requires: gcloud CLI and cloud-sql-proxy installed, roles/cloudsql.client access.
  - Keep secrets out of files where possible; this script reads DB password from Secret Manager at runtime.
  - To revert to in-memory mode: run "stop" and unset env or open a new shell session.
EOF
}

_cmd="${1:-help}"
case "$__DT_SOURCED:$__DT_SOURCED:$_cmd" in
  *:start) start ;;
  *:stop)  stop; _unset_env ;;
  *:status) status ;;
  *:help|*) help ;;
 esac

