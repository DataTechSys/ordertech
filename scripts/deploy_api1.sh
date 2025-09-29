#!/usr/bin/env bash
# Deploy the device-facing App API (api1) to Cloud Run in me-central1.
# Usage: scripts/deploy_api1.sh [SERVICE_NAME]
# Defaults: SERVICE_NAME=ordertech-api1
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-smart-order-469705}"
REGION="${REGION:-me-central1}"
SERVICE="${1:-${SERVICE:-api1}}"
SRC_DIR="DisplayApp/server/api1"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "ERROR: $SRC_DIR not found" >&2
  exit 1
fi

if [[ "$REGION" != "me-central1" ]]; then
  echo "ERROR: Region must be me-central1 (got '$REGION')" >&2
  exit 1
fi

echo "[api1] Building and deploying $SERVICE in $PROJECT_ID/$REGION"

# Build and deploy directly from source directory
gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
--platform managed \
  --source "$SRC_DIR" \
  --quiet \
  --port 8080 \
  --allow-unauthenticated \
  --set-env-vars "ADMIN_BASE=https://app.ordertech.me" \
  --ingress all

# Print URL
URL=$(gcloud run services describe "$SERVICE" --region="$REGION" --format="value(status.url)")
echo "[api1] Deployed: $URL"
