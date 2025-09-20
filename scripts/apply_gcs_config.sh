#!/usr/bin/env bash
set -euo pipefail

# Apply Google Cloud Storage (GCS) CORS and IAM settings for the assets bucket.
#
# Defaults:
#   - BUCKET comes from $ASSETS_BUCKET or falls back to "ordertech.me"
#   - CORS JSON comes from $CORS_FILE or infra/gcs-cors.json
#
# Requirements:
#   - gsutil installed and authenticated (e.g., `gcloud auth login`)
#   - You have permissions to modify bucket CORS and IAM
#
# Examples:
#   export ASSETS_BUCKET=ordertech.me
#   scripts/apply_gcs_config.sh --apply-cors
#   scripts/apply_gcs_config.sh --set-public-read
#   scripts/apply_gcs_config.sh --revoke-public-read
#   scripts/apply_gcs_config.sh --verify
#   scripts/apply_gcs_config.sh --bucket my-bucket --cors-file infra/gcs-cors.json --apply-cors

usage() {
  cat <<'EOF'
Usage: scripts/apply_gcs_config.sh [FLAGS]

Flags:
  --bucket <name>            Bucket name (default: $ASSETS_BUCKET or ordertech.me)
  --cors-file <path>         Path to CORS JSON (default: $CORS_FILE or infra/gcs-cors.json)
  --apply-cors               Apply CORS policy from the JSON file
  --set-public-read          Grant public read of objects (allUsers:objectViewer)
  --revoke-public-read       Revoke public read of objects
  --verify                   Print current bucket CORS and IAM settings
  -h, --help                 Show this help

Notes:
- Public read is optional. For private objects, use signed URLs from the backend instead.
- This script backs up existing CORS settings before applying new ones.
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Error: required command not found: $1" >&2; exit 1; }
}

BUCKET="${ASSETS_BUCKET:-ordertech.me}"
CORS_FILE="${CORS_FILE:-infra/gcs-cors.json}"
APPLY_CORS=false
SET_PUBLIC=false
REVOKE_PUBLIC=false
VERIFY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bucket)
      [[ $# -ge 2 ]] || { echo "--bucket requires a value" >&2; exit 1; }
      BUCKET="$2"; shift 2;;
    --cors-file)
      [[ $# -ge 2 ]] || { echo "--cors-file requires a value" >&2; exit 1; }
      CORS_FILE="$2"; shift 2;;
    --apply-cors)
      APPLY_CORS=true; shift;;
    --set-public-read)
      SET_PUBLIC=true; shift;;
    --revoke-public-read)
      REVOKE_PUBLIC=true; shift;;
    --verify)
      VERIFY=true; shift;;
    -h|--help)
      usage; exit 0;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1;;
  esac
done

if ! $APPLY_CORS && ! $SET_PUBLIC && ! $REVOKE_PUBLIC && ! $VERIFY; then
  echo "No action flags provided." >&2
  usage
  exit 1
fi

require_cmd gsutil

if ! gsutil ls -b "gs://$BUCKET" >/dev/null 2>&1; then
  echo "Error: bucket gs://$BUCKET not found or access denied." >&2
  exit 1
fi

backup_dir="infra"
mkdir -p "$backup_dir"
backup_file="$backup_dir/gcs-cors.backup.$(date +%Y%m%d-%H%M%S).json"

if $APPLY_CORS; then
  echo "Backing up existing CORS to $backup_file"
  gsutil cors get "gs://$BUCKET" > "$backup_file" || true
  echo "Applying CORS from $CORS_FILE to gs://$BUCKET"
  gsutil cors set "$CORS_FILE" "gs://$BUCKET"
fi

if $SET_PUBLIC; then
  echo "Granting public read of objects (allUsers:objectViewer) on gs://$BUCKET"
  gsutil iam ch allUsers:objectViewer "gs://$BUCKET"
fi

if $REVOKE_PUBLIC; then
  echo "Revoking public read of objects on gs://$BUCKET"
  gsutil iam ch -d allUsers:objectViewer "gs://$BUCKET"
fi

if $VERIFY; then
  echo "\nCurrent CORS for gs://$BUCKET:"
  gsutil cors get "gs://$BUCKET" || true
  echo "\nCurrent IAM policy for gs://$BUCKET:"
  gsutil iam get "gs://$BUCKET" || true
fi
