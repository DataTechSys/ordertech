#!/usr/bin/env bash
# Shared helpers for deployment scripts
set -Eeuo pipefail
IFS=$'\n\t'

_die(){ echo "ERROR: $*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || _die "Missing required command: $1"; }
info(){ echo "[INFO] $*"; }

repo_root(){ cd "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null && pwd; }
ensure_repo_root(){ cd "$(repo_root)"; }

load_env(){
  local f="${1:-config/prod.env}"
  [ -f "$f" ] || _die "Config file not found: $f"
  set -a
  # shellcheck disable=SC1090
  source "$f"
  set +a
  export PROJECT_ID REGION SERVICE_NAME CLOUDSQL_INSTANCE GCLOUD_CONFIG_NAME PLATFORM REQUIRED_APIS
}

gcloud_val(){ gcloud config get-value "$1" 2>/dev/null | tr -d '\r'; }

assert_eq(){
  local expected="$1" actual="$2" msg="$3"
  [ "$expected" = "$actual" ] || _die "$msg (expected: $expected, actual: $actual)"
}

validate_gcloud_env(){
  need gcloud
  local active acct proj run_region
active="$(gcloud config configurations list --format='value(name)' --filter=is_active=true || true)"
  [ -n "$active" ] || _die "No active gcloud configuration. Run: make gcloud-config"
  [ -n "${GCLOUD_CONFIG_NAME:-}" ] || _die "GCLOUD_CONFIG_NAME is not set"
  [ "$active" = "$GCLOUD_CONFIG_NAME" ] || _die "Active gcloud config must be '$GCLOUD_CONFIG_NAME' but is '$active'"

  acct="$(gcloud config get-value core/account 2>/dev/null || true)"
  [ -n "$acct" ] || _die "No gcloud account authenticated. Run: gcloud auth login"

  proj="$(gcloud_val core/project)"
  assert_eq "$PROJECT_ID" "$proj" "gcloud project mismatch"

  run_region="$(gcloud_val run/region || true)"
  if [ -z "$run_region" ]; then
    run_region="$(gcloud_val compute/region || true)"
  fi
  assert_eq "$REGION" "$run_region" "gcloud region mismatch"

  # Validate Cloud SQL instance belongs to this project and region
  local sql_proj sql_region sql_instance actual_sql_region
  IFS=: read -r sql_proj sql_region sql_instance <<< "$CLOUDSQL_INSTANCE"
  [ "$sql_proj" = "$PROJECT_ID" ] || _die "CLOUDSQL_INSTANCE project mismatch: $sql_proj vs $PROJECT_ID"
  actual_sql_region="$(gcloud sql instances describe "$sql_instance" --project="$sql_proj" --format="value(region)" 2>/dev/null || true)"
  [ -n "$actual_sql_region" ] || _die "Cloud SQL instance '$sql_instance' not found in project '$sql_proj'"
  assert_eq "$REGION" "$actual_sql_region" "Cloud SQL instance region mismatch"
}

# Validate project and a specific region only (no Cloud SQL check)
validate_gcloud_env_region(){
  local expect_region="$1"
  need gcloud
  local active acct proj run_region
  active="$(gcloud config configurations list --format=value(name) --filter=is_active=true || true)"
  [ -n "$active" ] || _die "No active gcloud configuration. Run: make gcloud-config"
  [ -n "${GCLOUD_CONFIG_NAME:-}" ] || _die "GCLOUD_CONFIG_NAME is not set"
  [ "$active" = "$GCLOUD_CONFIG_NAME" ] || _die "Active gcloud config must be '$GCLOUD_CONFIG_NAME' but is '$active'"

  acct="$(gcloud config get-value core/account 2>/dev/null || true)"
  [ -n "$acct" ] || _die "No gcloud account authenticated. Run: gcloud auth login"

  proj="$(gcloud_val core/project)"
  assert_eq "$PROJECT_ID" "$proj" "gcloud project mismatch"

  run_region="$(gcloud_val run/region || true)"
  if [ -z "$run_region" ]; then
    run_region="$(gcloud_val compute/region || true)"
  fi
  assert_eq "$expect_region" "$run_region" "gcloud region mismatch"
}

confirm_production(){
  echo "About to deploy to PRODUCTION:"
  echo "  project=$PROJECT_ID  region=$REGION  service=$SERVICE_NAME"
  read -r -p "Type '$PROJECT_ID/$REGION/$SERVICE_NAME' to confirm: " resp
  [ "$resp" = "$PROJECT_ID/$REGION/$SERVICE_NAME" ] || _die "Confirmation failed"
}
