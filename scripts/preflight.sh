#!/usr/bin/env bash
set -Eeuo pipefail
. "$(dirname "$0")/_lib.sh"
ensure_repo_root
load_env config/prod.env
validate_gcloud_env
info "Preflight OK: project=$PROJECT_ID region=$REGION service=$SERVICE_NAME (config=$GCLOUD_CONFIG_NAME)"
