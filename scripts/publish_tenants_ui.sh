#!/usr/bin/env bash
# Publish Tenants UI to Google Cloud Storage under gs://$ASSETS_BUCKET/tenants/
# Usage:
#   scripts/publish_tenants_ui.sh [SOURCE_DIR]
# Notes:
# - Defaults to using ASSETS_BUCKET from config/prod.env or env (falls back to ordertech.me)
# - Sets long Cache-Control for static assets and no-cache for HTML documents
# - Requires: gcloud, gsutil

set -euo pipefail

# Load canonical prod config (no secrets)
if [[ -f "config/prod.env" ]]; then
  # shellcheck disable=SC1091
  . "config/prod.env"
fi

SRC_DIR="${1:-tenants-ui}"
BUCKET="${ASSETS_BUCKET:-ordertech.me}"
PREFIX="tenants"
REGION="${REGION:-me-central1}"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "ERROR: SOURCE_DIR '$SRC_DIR' not found. Create it or pass a valid path." >&2
  exit 1
fi

echo "[publish] Bucket: gs://$BUCKET  Region: $REGION  Source: $SRC_DIR  Dest prefix: $PREFIX/"

# Ensure bucket exists (idempotent)
if ! gsutil ls -b "gs://$BUCKET" >/dev/null 2>&1; then
  echo "[publish] Creating bucket gs://$BUCKET in region $REGION"
  gsutil mb -l "$REGION" -b on "gs://$BUCKET"
fi

# Sync all files to tenants/ (delete extraneous dest files)
echo "[publish] Syncing files..."
# Using rsync preserves content-type by extension; cache-control set in next steps
gsutil -m rsync -r -d "$SRC_DIR" "gs://$BUCKET/$PREFIX"

# Set long-lived cache for everything first (immutable assets)
echo "[publish] Setting Cache-Control for assets (long TTL)"
gsutil -m setmeta -r -h "Cache-Control: public, max-age=31536000, immutable" "gs://$BUCKET/$PREFIX"

# Then override HTML documents to no-cache
TMP_HTML_LIST="$(mktemp)"
trap 'rm -f "$TMP_HTML_LIST"' EXIT
# List all objects and filter *.html
if gsutil ls -r "gs://$BUCKET/$PREFIX/**" 2>/dev/null | grep -E '\.html$' >"$TMP_HTML_LIST"; then
  if [[ -s "$TMP_HTML_LIST" ]]; then
    echo "[publish] Overriding Cache-Control for HTML files (no-cache)"
    # Batch updates for efficiency
    xargs -n 50 -a "$TMP_HTML_LIST" gsutil -m setmeta -h "Cache-Control: no-cache, max-age=0"
  fi
fi

echo "[publish] Done. Tenants UI available at: https://storage.googleapis.com/$BUCKET/$PREFIX/"
