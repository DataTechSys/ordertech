#!/usr/bin/env bash
# scripts/grant_koobs_admin_job.sh
# Safely rotate DB password, fix DATABASE_URL_ME to point to the correct Cloud SQL socket,
# update the Cloud Run job, and execute it to grant admin for Koobs.
# No secrets are printed.
set -euo pipefail

PROJECT="smart-order-469705"
REGION="me-central1"
INSTANCE="ordertech-db"
CONN="${PROJECT}:${REGION}:${INSTANCE}"
TENANT="3feff9a3-4721-4ff2-a716-11eb93873fae"
EMAIL="hussain@mosawi.com"
ROLE="admin"

# 1) Fetch current DATABASE_URL_ME (not printed)
DB_URL=$(gcloud secrets versions access latest --secret=DATABASE_URL_ME)

# 2) Parse user and database name from URL (not printed)
DB_USER=$(printf %s "$DB_URL" | sed -E 's|^[a-z]+://([^:]+):.*$|\1|I')
DB_NAME=$(printf %s "$DB_URL" | sed -E 's|.*/([^/?#]+).*|\1|')
if [[ -z "${DB_USER}" || -z "${DB_NAME}" ]]; then
  echo "ERROR: Could not parse DB user or DB name from DATABASE_URL_ME" >&2
  exit 2
fi

# 3) Generate a strong password (alphanumeric to avoid URL-encoding concerns)
DB_PASS=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)

# 4) Reset Cloud SQL password for this user on the right instance
printf "Resetting password for user %s on instance %s...\n" "$DB_USER" "$INSTANCE"
gcloud sql users set-password "$DB_USER" --instance="$INSTANCE" --password="$DB_PASS" --quiet

# 5) Build corrected DATABASE_URL pointing to the Cloud SQL unix socket
NEW_URL="postgresql://${DB_USER}:${DB_PASS}@/${DB_NAME}?host=/cloudsql/${CONN}"

# 6) Add a new version to DATABASE_URL_ME with the corrected URL
TMP_FILE=$(mktemp)
printf %s "$NEW_URL" > "$TMP_FILE"
gcloud secrets versions add DATABASE_URL_ME --data-file="$TMP_FILE" --quiet
rm -f "$TMP_FILE"

echo "Secret updated. Updating grant job..."

# 7) Update the grant job with discrete PG env vars and attach Cloud SQL
IMAGE=$(gcloud run services describe smart-order --region="$REGION" --format='value(spec.template.spec.containers[0].image)')

gcloud run jobs update smart-order-grant-admin \
  --region="$REGION" \
  --image "$IMAGE" \
  --command node \
  --args scripts/grant_admin.js \
  --set-cloudsql-instances "$CONN" \
  --set-env-vars PGHOST=/cloudsql/$CONN,PGUSER="$DB_USER",PGPASSWORD="$DB_PASS",PGDATABASE="$DB_NAME",EMAIL="$EMAIL",TENANT="$TENANT",ROLE="$ROLE" \
  --quiet

echo "Executing grant job..."
if ! gcloud run jobs execute smart-order-grant-admin --region="$REGION" --wait; then
  echo "Grant job execution reported failure; inspecting logs..." >&2
fi

echo "Recent success logs (if any):"
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"smart-order-grant-admin\" AND resource.labels.location=\"$REGION\" AND (jsonPayload.ok=1 OR textPayload:(\"\\\"ok\\\":true\"))" --limit=3 --order=desc --format=json || true

echo "Done."

