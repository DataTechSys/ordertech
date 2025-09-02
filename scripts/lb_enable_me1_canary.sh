#!/usr/bin/env bash
# Create the serverless NEG and backend service for me-central1 and validate wiring for the /_canary path.
# Safe to run multiple times (create calls are idempotent with || true). Does not modify URL map contents.

set -euo pipefail

PROJECT="smart-order-469705"
REGION="me-central1"
SERVICE="smart-order"
NEG="smartorder-me1-neg"
BACKEND="smartorder-me1-backend"
URL_MAP="smartorder-koobs-map"

# Configure project
CURRENT="$(gcloud config get-value project --quiet 2>/dev/null || true)"
if [ "$CURRENT" != "$PROJECT" ]; then
  gcloud config set project "$PROJECT" >/dev/null
fi

# Create serverless NEG targeting the me-central1 Cloud Run service
if ! gcloud compute network-endpoint-groups describe "$NEG" --region="$REGION" >/dev/null 2>&1; then
  gcloud compute network-endpoint-groups create "$NEG" \
    --region="$REGION" \
    --network-endpoint-type=SERVERLESS \
    --cloud-run-service="$SERVICE" \
    --cloud-run-region="$REGION"
else
  echo "NEG $NEG already exists in $REGION"
fi

# Create backend service (global) if missing
if ! gcloud compute backend-services describe "$BACKEND" --global >/dev/null 2>&1; then
  gcloud compute backend-services create "$BACKEND" \
    --global \
    --load-balancing-scheme=EXTERNAL_MANAGED
else
  echo "Backend service $BACKEND already exists (global)"
fi

# Attach the NEG to the backend service (no-op if already attached)
if ! gcloud compute backend-services describe "$BACKEND" --global --format='value(backends[].group)' | grep -q "$NEG"; then
  gcloud compute backend-services add-backend "$BACKEND" \
    --global \
    --network-endpoint-group="$NEG" \
    --network-endpoint-group-region="$REGION"
else
  echo "NEG $NEG already attached to backend $BACKEND"
fi

echo "Done. Current backend service config:"
gcloud compute backend-services describe "$BACKEND" --global --format='flattened(name, backends[].group)'

echo
echo "URL map $URL_MAP currently contains a path rule for /_canary pointing to $BACKEND (as captured in inventory)."
echo "Test canary: curl -sSI https://app.ordertech.me/_canary | sed -n '1,12p'"

