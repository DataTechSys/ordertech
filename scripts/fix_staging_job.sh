#!/usr/bin/env bash
# Fix staging job to use discrete PG* env vars and a password-only secret.
# - Rotates the staging DB user password and stores it in DB_PASSWORD_STAGING
# - Updates the Cloud Run job to map PGHOST/PGPORT/PGUSER/PGDATABASE + PGPASSWORD
# - Executes the migration job

set -euo pipefail
PROJECT=smart-order-469705
REGION=me-central1
INSTANCE=ordertech-stg-sql
DB_NAME=smart_order_stg
DB_USER=ordertech

# Generate a strong password (not printed)
DB_PASS=$(python3 - <<"PY"
import secrets, string
alphabet = string.ascii_letters + string.digits + "@#%^&*+=_"
print("".join(secrets.choice(alphabet) for _ in range(32)))
PY
)

# Set DB password
gcloud sql users set-password "$DB_USER" \
  --instance="$INSTANCE" --project="$PROJECT" \
  --password="$DB_PASS" >/dev/null

# Ensure secret and rotate version (no printing)
if ! gcloud secrets describe DB_PASSWORD_STAGING --project="$PROJECT" >/dev/null 2>&1; then
  gcloud secrets create DB_PASSWORD_STAGING --project="$PROJECT" --replication-policy=automatic >/dev/null
fi
printf %s "$DB_PASS" | gcloud secrets versions add DB_PASSWORD_STAGING --project="$PROJECT" --data-file=- >/dev/null
unset DB_PASS

# Compute connection name for socket path
CONN=$(gcloud sql instances describe "$INSTANCE" --project="$PROJECT" --format='value(connectionName)')

# Remove DATABASE_URL and set explicit PG* env vars
# Note: two-step update because gcloud allows only one secrets flag per call
if gcloud run jobs describe migrate-smart-order-staging --project="$PROJECT" --region="$REGION" >/dev/null 2>&1; then
  gcloud run jobs update migrate-smart-order-staging --project="$PROJECT" --region="$REGION" \
    --remove-secrets DATABASE_URL >/dev/null || true
  gcloud run jobs update migrate-smart-order-staging --project="$PROJECT" --region="$REGION" \
    --set-env-vars PGHOST=/cloudsql/$CONN,PGPORT=5432,PGUSER=$DB_USER,PGDATABASE=$DB_NAME \
    --set-secrets PGPASSWORD=DB_PASSWORD_STAGING:latest >/dev/null
else
  # Create if missing
  gcloud run jobs create migrate-smart-order-staging --project="$PROJECT" --region="$REGION" \
    --image me-central1-docker.pkg.dev/$PROJECT/smart-order/ordertech:latest \
    --command node --args scripts/migrate.js \
    --set-env-vars PGHOST=/cloudsql/$CONN,PGPORT=5432,PGUSER=$DB_USER,PGDATABASE=$DB_NAME \
    --set-secrets PGPASSWORD=DB_PASSWORD_STAGING:latest \
    --set-cloudsql-instances "$CONN" >/dev/null
fi

# Execute the migration job
set +e
OUT=$(gcloud run jobs execute migrate-smart-order-staging --project="$PROJECT" --region="$REGION" --wait 2>&1)
RC=$?
set -e
if [[ $RC -ne 0 ]]; then
  echo "$OUT" >&2
  exit $RC
fi

echo "Staging migrations executed successfully."
