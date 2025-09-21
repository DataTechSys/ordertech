#!/usr/bin/env bash
# Unified deploy script pinned to me-central1. Fails if a different region is provided.
set -euo pipefail

# Load canonical production config (no secrets)
if [[ -f "config/prod.env" ]]; then
  # shellcheck disable=SC1091
  . "config/prod.env"
fi

PROJECT_ID="${PROJECT_ID:-smart-order-469705}"
SERVICE="${SERVICE:-ordertech}"
REGION="${REGION:-me-central1}"
DB_INSTANCE="${DB_INSTANCE:-smart-order-469705:me-central1:ordertech-db}"
ASSETS_BUCKET="${ASSETS_BUCKET:-ordertech.me}"
TENANTS_UI_BASE="${TENANTS_UI_BASE:-https://storage.googleapis.com/${ASSETS_BUCKET}/tenants/}"

if [[ "$REGION" != "me-central1" ]]; then
  echo "ERROR: Region must be me-central1 (got '$REGION')" >&2
  exit 1
fi

echo "[deploy] Project=$PROJECT_ID Service=$SERVICE Region=$REGION"

# Deploy from source with minimized context (via .gcloudignore)
gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --platform managed \
  --source . \
  --quiet \
  --add-cloudsql-instances "$DB_INSTANCE" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,LIVEKIT_API_KEY=livekit-api-key:latest,LIVEKIT_API_SECRET=livekit-api-secret:latest" \
  --update-env-vars "PGHOST=/cloudsql/$DB_INSTANCE,REQUIRE_DB=true,SKIP_DEFAULT_TENANT=1,DEFAULT_TENANT_ID=56ac557e-589d-4602-bc9b-946b201fb6f6,RTC_FALLBACK_ORDER=p2p,API_BASE_URL=https://app.ordertech.me" \
  --allow-unauthenticated
