#!/usr/bin/env bash
# Setup or rotate DATABASE_URL in Google Secret Manager and wire it to Cloud Run (prod).
# Prompts for DB password securely; does not print secrets.
# Usage: bash scripts/setup_db_secret.sh

set -Eeuo pipefail
. "$(dirname "$0")/_lib.sh"
ensure_repo_root
load_env config/prod.env

# Requirements
need gcloud
need node

# Validate we are in the canonical project/region and instance
validate_gcloud_env

# Defaults for prompt-able inputs
DB_USER="${DB_USER:-ordertech}"
DB_NAME="${DB_NAME:-ordertech}"

# Prompt (non-echo) for password and optional user override
read -r -p "DB user [${DB_USER}]: " __in || true
DB_USER="${__in:-$DB_USER}"
read -s -p "DB password (hidden): " DB_PASS; echo

# Create secret if missing
if ! gcloud secrets describe DATABASE_URL --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create DATABASE_URL --project "$PROJECT_ID" --replication-policy=automatic >/dev/null
fi

# Build URL safely (no printing) using CLOUDSQL_INSTANCE from config
DATABASE_URL=$(node -e 'const e=encodeURIComponent; const u=process.env; process.stdout.write(`postgres://${e(u.DB_USER)}:${e(u.DB_PASS)}@/${e(u.DB_NAME)}?host=/cloudsql/${u.CONN}`);' \
  DB_USER="$DB_USER" DB_PASS="$DB_PASS" DB_NAME="$DB_NAME" CONN="$CLOUDSQL_INSTANCE")

# Add/rotate secret version
printf "%s" "$DATABASE_URL" | gcloud secrets versions add DATABASE_URL --project "$PROJECT_ID" --data-file=- >/dev/null

# Grant Cloud Run runtime SA access
RUNTIME_SA="$(gcloud run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" --format='value(spec.template.spec.serviceAccountName)')"
if [ -n "$RUNTIME_SA" ]; then
  gcloud secrets add-iam-policy-binding DATABASE_URL \
    --project "$PROJECT_ID" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null || true
fi

# Update Cloud Run service to use the secret and attach Cloud SQL
gcloud run services update "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --add-cloudsql-instances="$CLOUDSQL_INSTANCE" \
  --platform=managed >/dev/null

# Cleanup sensitive variables in the shell
unset DB_PASS DATABASE_URL __in

echo "Done: DATABASE_URL rotated and Cloud Run updated for ${SERVICE_NAME} in ${REGION}."
