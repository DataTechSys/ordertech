#!/usr/bin/env bash
set -Eeuo pipefail
. "$(dirname "$0")/_lib.sh"
ensure_repo_root
load_env config/prod.env
need gcloud

if ! gcloud config configurations describe "$GCLOUD_CONFIG_NAME" >/dev/null 2>&1; then
  gcloud config configurations create "$GCLOUD_CONFIG_NAME"
fi

gcloud config configurations activate "$GCLOUD_CONFIG_NAME"
gcloud config set core/project "$PROJECT_ID"
gcloud config set run/region "$REGION"
gcloud config set compute/region "$REGION"

info "Active config: $GCLOUD_CONFIG_NAME"
info "If not already authenticated, run: gcloud auth login"
info "Enabling required APIs in project $PROJECT_ID ..."
for api in $REQUIRED_APIS; do
  gcloud services enable "$api" --project "$PROJECT_ID"
done
info "Done."
