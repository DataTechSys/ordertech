#!/usr/bin/env bash
set -euo pipefail

# Usage: scripts/deploy.sh [staging|prod]
# Default is prod.
ENVIRONMENT="${1:-prod}"

PROJECT_ID="$(gcloud config get-value project)"
REGION="${REGION:-us-central1}"
AR_LOCATION="${AR_LOCATION:-us-central1}"
REPO="smart-order"
# Ensure assets bucket is set; allow override via env
ASSETS_BUCKET="${ASSETS_BUCKET:-smart-order-assets-me-central1-715493130630}"

if [[ "$ENVIRONMENT" == "staging" ]]; then
  SERVICE="smart-order-staging"
else
  SERVICE="smart-order"
fi

VERSION="$(date +%Y%m%d-%H%M%S)"
IMAGE="${AR_LOCATION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:${VERSION}"

echo "Building ${IMAGE}..." >&2
gcloud builds submit --tag "${IMAGE}"

echo "Deploying to Cloud Run service ${SERVICE}..." >&2
gcloud run deploy "${SERVICE}" \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --platform=managed \
  --port=8080 \
  --update-env-vars "ASSETS_BUCKET=${ASSETS_BUCKET}"

echo "Deployment complete. Service URL:" >&2
gcloud run services describe "${SERVICE}" --region="${REGION}" --format='value(status.url)'
