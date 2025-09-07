#!/usr/bin/env bash
# Provision staging environment for OrderTech in the same project.
# - Creates Cloud SQL instance `ordertech-stg-sql` (if missing)
# - Creates DB `smart_order_stg` and user `ordertech` (prompts for password unless DB_PASS is preset)
# - Creates/rotates Secret Manager secret DATABASE_URL_STAGING (Unix-socket URL)
# - Grants runtime SA secret accessor + cloudsql.client
# - Creates/updates Cloud Run Job `migrate-smart-order-staging` and executes it
# - Deploys Cloud Run service `ordertech-staging`
#
# Usage:
#   bash scripts/provision_staging.sh [--region <region>] [--image <image-ref>] [--assets-bucket <bucket-name>]
# Notes:
#   - Requires gcloud and node installed and authenticated
#   - Does NOT print secrets; prompts for DB password securely if DB_PASS not set
#   - You can pass an existing image via --image (e.g., me-central1-docker.pkg.dev/PROJECT/smart-order/ordertech:TAG)

set -euo pipefail

# --- parse args
REGION="me-central1"
IMAGE=""
ASSETS_BUCKET_DEFAULT="smart-order-assets-me-central1-715493130630"
ASSETS_BUCKET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2;;
    --image) IMAGE="$2"; shift 2;;
    --assets-bucket) ASSETS_BUCKET="$2"; shift 2;;
    *) echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

# --- prerequisites
for cmd in gcloud node; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: $cmd is required." >&2
    exit 1
  fi
done

PROJECT_ID="$(gcloud config get-value project --quiet 2>/dev/null || true)"
if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: gcloud project is not set. Run: gcloud config set project <PROJECT_ID>" >&2
  exit 1
fi

# --- resources
STAGING_INSTANCE="ordertech-stg-sql"
STAGING_DB="smart_order_stg"
DB_USER="ordertech"
SECRET_NAME="DATABASE_URL_STAGING"
SERVICE_PROD="ordertech"
SERVICE_STAGING="ordertech-staging"
JOB_STAGING="migrate-smart-order-staging"

# --- ensure Cloud SQL instance
if ! gcloud sql instances describe "$STAGING_INSTANCE" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Creating Cloud SQL instance $STAGING_INSTANCE in $REGION..." >&2
  gcloud sql instances create "$STAGING_INSTANCE" \
    --project="$PROJECT_ID" \
    --database-version=POSTGRES_15 \
    --region="$REGION" \
    --tier=db-custom-2-7680 \
    --storage-auto-increase || {
      echo "ERROR: Cloud SQL instance creation failed." >&2; exit 1; }
else
  echo "Cloud SQL instance $STAGING_INSTANCE already exists." >&2
fi

# --- ensure DB
if ! gcloud sql databases describe "$STAGING_DB" --instance="$STAGING_INSTANCE" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Creating database $STAGING_DB..." >&2
  gcloud sql databases create "$STAGING_DB" --instance="$STAGING_INSTANCE" --project="$PROJECT_ID"
else
  echo "Database $STAGING_DB already exists." >&2
fi

# --- ensure DB user
if ! gcloud sql users list --instance="$STAGING_INSTANCE" --project="$PROJECT_ID" --format='value(name)' | grep -qx "$DB_USER"; then
  if [[ -z "${DB_PASS:-}" ]]; then
    # Prompt securely (no echo). This script itself is non-interactive for CI, but safe for human-operated terminals.
    read -s -p "Set password for staging DB user '$DB_USER' (hidden): " DB_PASS; echo
  fi
  gcloud sql users create "$DB_USER" \
    --instance="$STAGING_INSTANCE" \
    --project="$PROJECT_ID" \
    --password="$DB_PASS"
else
  echo "DB user $DB_USER already exists (not rotating here)." >&2
fi

# --- build DATABASE_URL and store in Secret Manager
CONN_NAME="$(gcloud sql instances describe "$STAGING_INSTANCE" --project="$PROJECT_ID" --format='value(connectionName)')"
if ! gcloud secrets describe "$SECRET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create "$SECRET_NAME" --project="$PROJECT_ID" --replication-policy=automatic
fi

if [[ -n "${DB_PASS:-}" ]]; then
  DATABASE_URL=$(node -e 'const e=encodeURIComponent; const u=process.env; process.stdout.write(`postgres://${e(u.DB_USER)}:${e(u.DB_PASS)}@/${e(u.DB_NAME)}?host=/cloudsql/${u.CONN}`);' \
    DB_USER="$DB_USER" DB_PASS="$DB_PASS" DB_NAME="$STAGING_DB" CONN="$CONN_NAME")
  printf "%s" "$DATABASE_URL" | gcloud secrets versions add "$SECRET_NAME" --project="$PROJECT_ID" --data-file=- >/dev/null
  unset DATABASE_URL DB_PASS || true
else
  echo "Skipping secret rotation for $SECRET_NAME (DB_PASS not provided). Secret must already have a usable version." >&2
fi

# --- grant runtime SA access
RUNTIME_SA="$(gcloud run services describe "$SERVICE_PROD" --project="$PROJECT_ID" --region="$REGION" --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)"
if [[ -z "$RUNTIME_SA" ]]; then
  # Fallback to default compute SA
  PROJ_NUM="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  RUNTIME_SA="${PROJ_NUM}-compute@developer.gserviceaccount.com"
fi

echo "Granting secret accessor to $RUNTIME_SA on $SECRET_NAME ..." >&2
gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor" >/dev/null || true

echo "Granting cloudsql.client to $RUNTIME_SA ..." >&2
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/cloudsql.client" >/dev/null || true

# --- choose image for staging
if [[ -z "$IMAGE" ]]; then
  IMAGE="$(gcloud run services describe "$SERVICE_PROD" --project="$PROJECT_ID" --region="$REGION" --format="value(spec.template.spec.containers[0].image)" 2>/dev/null || true)"
fi
if [[ -z "$IMAGE" ]]; then
  echo "No image specified and unable to infer from prod. You can pass --image <ref> or run Cloud Build to produce an image." >&2
  exit 1
fi

echo "Using image: $IMAGE" >&2

# --- create or update staging migration job and execute
if gcloud run jobs describe "$JOB_STAGING" --project="$PROJECT_ID" --region="$REGION" >/dev/null 2>&1; then
  gcloud run jobs update "$JOB_STAGING" \
    --project="$PROJECT_ID" --region="$REGION" \
    --image "$IMAGE" \
    --command node --args scripts/migrate.js \
    --set-secrets DATABASE_URL=${SECRET_NAME}:latest \
    --set-cloudsql-instances "$CONN_NAME" \
    --set-env-vars PGHOST=/cloudsql/$CONN_NAME,PGPORT=5432 \
    --service-account "$RUNTIME_SA"
else
  gcloud run jobs create "$JOB_STAGING" \
    --project="$PROJECT_ID" --region="$REGION" \
    --image "$IMAGE" \
    --command node --args scripts/migrate.js \
    --set-secrets DATABASE_URL=${SECRET_NAME}:latest \
    --set-cloudsql-instances "$CONN_NAME" \
    --set-env-vars PGHOST=/cloudsql/$CONN_NAME,PGPORT=5432 \
    --service-account "$RUNTIME_SA"
fi

echo "Running staging migrations..." >&2
gcloud run jobs execute "$JOB_STAGING" --project="$PROJECT_ID" --region="$REGION" --wait

echo "Deploying Cloud Run service $SERVICE_STAGING ..." >&2
if [[ -z "$ASSETS_BUCKET" ]]; then ASSETS_BUCKET="$ASSETS_BUCKET_DEFAULT"; fi

gcloud run deploy "$SERVICE_STAGING" \
  --project="$PROJECT_ID" --region="$REGION" \
  --image "$IMAGE" \
  --platform managed \
  --port 8080 \
  --set-secrets DATABASE_URL=${SECRET_NAME}:latest \
  --add-cloudsql-instances "$CONN_NAME" \
  --update-env-vars "ASSETS_BUCKET=$ASSETS_BUCKET" \
  --service-account "$RUNTIME_SA" \
  --no-allow-unauthenticated

URL="$(gcloud run services describe "$SERVICE_STAGING" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
echo "Staging is ready: $URL"
