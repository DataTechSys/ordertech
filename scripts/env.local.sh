#!/usr/bin/env bash
# Local DB environment bootstrap for OrderTech
# - Uses Cloud SQL Auth Proxy unix socket at $HOME/.cloudsql/<INSTANCE>
# - Pulls DATABASE_URL from Secret Manager (name defaults to DATABASE_URL)
# - Does NOT print secrets; exports env for the current shell only
#
# Usage:
#   . scripts/env.local.sh
#   PORT=3000 npm start

set -euo pipefail

INSTANCE="smart-order-469705:me-central1:ordertech-db"
# Directory created by the Cloud SQL proxy for unix sockets
SOCKDIR="${HOME}/.cloudsql"
PGHOST_PATH="${SOCKDIR}/${INSTANCE}"

# Ensure proxy socket dir exists (proxy must be running separately, e.g., via LaunchAgent)
mkdir -p "${SOCKDIR}"

# Export PGHOST to use the unix socket for stable local connectivity
export PGHOST="${PGHOST_PATH}"
export PGPORT="${PGPORT:-5432}"
# Gate features that require DB
export REQUIRE_DB=1

# Pull full DATABASE_URL from Secret Manager (do not print)
SECRET_NAME="${DATABASE_URL_SECRET:-DATABASE_URL}"
if command -v gcloud >/dev/null 2>&1; then
  DBURL="$(gcloud secrets versions access latest --secret="${SECRET_NAME}" 2>/dev/null || true)"
else
  DBURL=""
fi
if [ -n "${DBURL}" ]; then
  # Strip any trailing CR/LF and optional prefix like DATABASE_URL=
  DBURL="$(printf "%s" "${DBURL}" | tr -d '\r\n')"
  DBURL="${DBURL#DATABASE_URL=}"
  export DATABASE_URL="${DBURL}"
else
  # Fallback: expect discrete PGUSER/PGPASSWORD/PGDATABASE to be set by user
  # Note: buildDbConfig() in server.js supports mixing PGHOST with DATABASE_URL or discrete vars.
  if [ -z "${PGUSER:-}" ] || [ -z "${PGDATABASE:-}" ]; then
    echo "[env.local] Warning: DATABASE_URL secret not available and PGUSER/PGDATABASE not set. Set PGUSER/PGPASSWORD/PGDATABASE or configure Secret Manager (DATABASE_URL)." >&2
  fi
fi