#!/usr/bin/env bash
# Sync Cloud SQL → local Postgres for the 'ordertech' database.
# - Uses Cloud SQL Auth Proxy via unix socket ($HOME/.cloudsql/<INSTANCE>)
# - Reads remote DB password from Secret Manager (DB_PASSWORD) without printing
# - Dumps remote DB (custom format) into backup/
# - Drops noisy log table locally to avoid index duplication warnings
# - Restores into local Postgres at 127.0.0.1:6555
# - Verifies selected rows afterwards
#
# Usage:
#   bash scripts/sync_cloud_to_local.sh
#
set -Eeuo pipefail

INSTANCE="${INSTANCE:-smart-order-469705:me-central1:ordertech-db}"
REMOTE_HOST="$HOME/.cloudsql/${INSTANCE}"
REMOTE_PORT=5432
REMOTE_USER="${REMOTE_USER:-ordertech}"
REMOTE_DB="${REMOTE_DB:-ordertech}"
LOCAL_HOST="${LOCAL_HOST:-127.0.0.1}"
LOCAL_PORT="${LOCAL_PORT:-6555}"
LOCAL_USER="${LOCAL_USER:-ordertech}"
LOCAL_DB="${LOCAL_DB:-ordertech}"
SECRET_NAME="${DB_PASSWORD_SECRET:-DB_PASSWORD}"

# Ensure backup directory
mkdir -p backup

# Fetch remote password into env (not printed)
if ! command -v gcloud >/dev/null 2>&1; then
  echo "[sync] gcloud CLI is required." >&2
  exit 1
fi
PGPASSWORD_REMOTE="$(gcloud secrets versions access latest --secret="${SECRET_NAME}" 2>/dev/null || true)"
if [ -z "${PGPASSWORD_REMOTE}" ]; then
  echo "[sync] Could not access Secret Manager secret: ${SECRET_NAME}" >&2
  exit 1
fi
export PGPASSWORD="${PGPASSWORD_REMOTE}"

# Create dump from remote (custom format)
STAMP="$(date +%Y%m%d%H%M%S)"
DUMP_FILE="backup/${REMOTE_DB}_${STAMP}.dump"

echo "[sync] Dumping remote ${REMOTE_DB} → ${DUMP_FILE}"
pg_dump -h "${REMOTE_HOST}" -p "${REMOTE_PORT}" -U "${REMOTE_USER}" -d "${REMOTE_DB}" -Fc -f "${DUMP_FILE}"

# Drop noisy local table to avoid duplicate index warnings
# Safe to drop: admin_activity_logs (app recreates/maintains indexes)
echo "[sync] Preparing local DB (drop admin_activity_logs if exists)"
psql -h "${LOCAL_HOST}" -p "${LOCAL_PORT}" -U "${LOCAL_USER}" -d "${LOCAL_DB}" -v ON_ERROR_STOP=1 -c "DROP TABLE IF EXISTS public.admin_activity_logs CASCADE;" || true

# Restore into local
unset PGPASSWORD # ensure we don't accidentally use remote creds for local

echo "[sync] Restoring into local ${LOCAL_DB}"
pg_restore -h "${LOCAL_HOST}" -p "${LOCAL_PORT}" -U "${LOCAL_USER}" -d "${LOCAL_DB}" --clean --if-exists -O -x "${DUMP_FILE}"

echo "[sync] Verify tenants locally (public.tenants)"
psql -h "${LOCAL_HOST}" -p "${LOCAL_PORT}" -U "${LOCAL_USER}" -d "${LOCAL_DB}" -Atc \
  "select tenant_id::text || '|' || company_name || '|' || coalesce(short_code,'') from public.tenants order by company_name;" | sed 's/^/[local] /'

echo "[sync] Done. Dump file: ${DUMP_FILE}"
