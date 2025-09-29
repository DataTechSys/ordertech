#!/usr/bin/env bash
# Fix staging job to use discrete PG* env vars and a password-only secret.
# - Rotates the staging DB user password and stores it in DB_PASSWORD_STAGING
# - Updates the Cloud Run job to map PGHOST/PGPORT/PGUSER/PGDATABASE + PGPASSWORD
# - Executes the migration job
#
set -Eeuo pipefail
. "$(dirname "$0")/_lib.sh"
ensure_repo_root
load_env config/prod.env

# staging params
STAGE_REGION="$REGION"
INSTANCE=ordertech-stg-sql
DB_NAME=smart_order_stg
DB_USER=ordertech

# Validate environment (project + region only)
validate_gcloud_env_region "$STAGE_REGION"

# Generate a strong password (not printed)
need python3
DB_PASS=$(python3 - <<"PY"
import secrets, string
alphabet = string.ascii_letters + string.digits + "@#%^&*+=_"
print("".join(secrets.choice(alphabet) for _ in range(32)))
PY
)

# Set DB password
gcloud sql users set-password "$DB_USER" \
  --instance="$INSTANCE" --project="$PROJECT_ID" \
  --password="$DB_PASS" >/dev/null

# Ensure secret and rotate version (no printing)
if ! gcloud secrets describe DB_PASSWORD_STAGING --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create DB_PASSWORD_STAGING --project="$PROJECT_ID" --replication-policy=automatic >/dev/null
fi
printf %s "$DB_PASS" | gcloud secrets versions add DB_PASSWORD_STAGING --project="$PROJECT_ID" --data-file=- >/dev/null
unset DB_PASS

# Compute connection name for socket path
CONN=$(gcloud sql instances describe "$INSTANCE" --project="$PROJECT_ID" --format='value(connectionName)')

# Determine latest prod image for job
IMAGE=$(gcloud run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$STAGE_REGION" --format='value(spec.template.spec.containers[0].image)' 2>/dev/null || true)

# Remove DATABASE_URL and set explicit PG* env vars
# Note: two-step update because gcloud allows only one secrets flag per call
if gcloud run jobs describe migrate-smart-order-staging --project="$PROJECT_ID" --region="$STAGE_REGION" >/dev/null 2>&1; then
  gcloud run jobs update migrate-smart-order-staging --project="$PROJECT_ID" --region="$STAGE_REGION" \
    --remove-secrets DATABASE_URL >/dev/null || true
  gcloud run jobs update migrate-smart-order-staging --project="$PROJECT_ID" --region="$STAGE_REGION" \
    --set-env-vars PGHOST=/cloudsql/$CONN,PGPORT=5432,PGUSER=$DB_USER,PGDATABASE=$DB_NAME \
    --set-secrets PGPASSWORD=DB_PASSWORD_STAGING:latest >/dev/null
else
  # Create if missing
  gcloud run jobs create migrate-smart-order-staging --project="$PROJECT_ID" --region="$STAGE_REGION" \
    --image "$IMAGE" \
    --command node --args scripts/migrate.js \
    --set-env-vars PGHOST=/cloudsql/$CONN,PGPORT=5432,PGUSER=$DB_USER,PGDATABASE=$DB_NAME \
    --set-secrets PGPASSWORD=DB_PASSWORD_STAGING:latest \
    --set-cloudsql-instances "$CONN" >/dev/null
fi

# Execute the migration job
set +e
OUT=$(gcloud run jobs execute migrate-smart-order-staging --project="$PROJECT_ID" --region="$STAGE_REGION" --wait 2>&1)
RC=$?
set -e
if [[ $RC -ne 0 ]]; then
  echo "$OUT" >&2
  exit $RC
fi

echo "Staging migrations executed successfully."
