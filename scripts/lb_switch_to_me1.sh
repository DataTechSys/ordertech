#!/usr/bin/env bash
# Switch app.ordertech.me default backend to me-central1 backend service.
# This edits the app-ordertech path matcher in the URL map to use smartorder-me1-backend.
# Requires: perl (available by default on macOS) and gcloud.

set -euo pipefail

PROJECT="smart-order-469705"
URL_MAP="smartorder-koobs-map"
OLD_BS_URL="https://www.googleapis.com/compute/beta/projects/${PROJECT}/global/backendServices/smartorder-ew1-backend"
NEW_BS_URL="https://www.googleapis.com/compute/beta/projects/${PROJECT}/global/backendServices/smartorder-me1-backend"
TMP="/tmp/urlmap.yaml"
NEW="/tmp/urlmap.new.yaml"

# Ensure project
if [[ "$(gcloud config get-value project 2>/dev/null || true)" != "$PROJECT" ]]; then
  gcloud config set project "$PROJECT" >/dev/null
fi

echo "Exporting URL map $URL_MAP..." >&2
gcloud compute url-maps export "$URL_MAP" --global --destination="$TMP"

# Replace defaultService only for the pathMatcher named 'app-ordertech'
perl -0777 -pe "s|(pathMatchers:\s*-\s*defaultService:\s*)\Q$OLD_BS_URL\E([\s\S]*?\n\s*name:\s*app-ordertech)|\${1}$NEW_BS_URL\${2}|m" "$TMP" > "$NEW"

# Safety check: ensure change happened
if ! diff -q "$TMP" "$NEW" >/dev/null; then
  echo "Importing updated URL map (switching app-ordertech to me1 backend)..." >&2
  gcloud compute url-maps import "$URL_MAP" --global --source="$NEW" --quiet
  echo "Validating..." >&2
  gcloud compute url-maps describe "$URL_MAP" --format='yaml(pathMatchers)'
  echo "Done." >&2
else
  echo "No change detected; either already on me1 backend or pattern not found." >&2
fi

