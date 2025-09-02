#!/usr/bin/env bash
# Setup or rotate DATABASE_URL in Google Secret Manager and wire it to Cloud Run.
# Prompts for DB password securely; does not print secrets.
# Usage: bash scripts/setup_db_secret.sh

set -euo pipefail

# Requirements
for cmd in gcloud node; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: $cmd not found. Please install it and try again." >&2
    exit 1
  fi
done

# Project
PROJECT="smart-order-469705"
CURRENT="$(gcloud config get-value project --quiet 2>/dev/null || true)"
if [ "$CURRENT" != "$PROJECT" ]; then
  gcloud config set project "$PROJECT" >/dev/null
fi

# Defaults (can be overridden via env before running)
DB_USER="${DB_USER:-ordertech}"
DB_NAME="${DB_NAME:-smart_order}"
INSTANCE="${INSTANCE:-smart-order-469705:me-central1:smart-order-pg-me1}"
REGION="${REGION:-me-central1}"
SERVICE="${SERVICE:-smart-order}"

# Prompt (non-echo) for password
read -p "DB user [${DB_USER}]: " __in || true
DB_USER="${__in:-$DB_USER}"
read -s -p "DB password (hidden): " DB_PASS; echo

# Create secret if missing
if ! gcloud secrets describe DATABASE_URL >/dev/null 2>&1; then
  gcloud secrets create DATABASE_URL --replication-policy=automatic >/dev/null
fi

# Build URL safely (no printing)
DATABASE_URL=$(node -e 'const e=encodeURIComponent; const u=process.env; process.stdout.write(`postgres://${e(u.DB_USER)}:${e(u.DB_PASS)}@/${e(u.DB_NAME)}?host=/cloudsql/${u.INSTANCE}`);' \
  DB_USER="$DB_USER" DB_PASS="$DB_PASS" DB_NAME="$DB_NAME" INSTANCE="$INSTANCE")

# Add/rotate secret version
printf "%s" "$DATABASE_URL" | gcloud secrets versions add DATABASE_URL --data-file=- >/dev/null

# Grant Cloud Run runtime SA access
RUNTIME_SA="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(spec.template.spec.serviceAccountName)')"
if [ -n "$RUNTIME_SA" ]; then
  gcloud secrets add-iam-policy-binding DATABASE_URL \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null || true
fi

# Update Cloud Run service to use the secret and attach Cloud SQL
gcloud run services update "$SERVICE" \
  --region="$REGION" \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --add-cloudsql-instances="$INSTANCE" \
  --platform=managed >/dev/null

# Cleanup sensitive variables in the shell
unset DB_PASS DATABASE_URL __in

echo "Done: DATABASE_URL rotated and Cloud Run updated for ${SERVICE} in ${REGION}."
