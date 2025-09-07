#!/usr/bin/env bash
# op_check.sh — Operational validation for app.ordertech.me
# - Verifies DNS A record
# - Confirms URL map default backend for app.ordertech.me
# - Ensures backend uses the ordertech serverless NEG in me-central1
# - Checks the serverless NEG binds to Cloud Run service ordertech
# - Validates Cloud Run service wiring (Cloud SQL attachment + DATABASE_URL secret mapping)
# - Probes service /dbz and LB /health endpoints
#
# Usage:
#   bash scripts/op_check.sh
#
# Optional overrides via env:
#   PROJECT, HOST, DESIRED_IP, REGION, SERVICE, URL_MAP, BACKEND, NEG

set -euo pipefail

PROJECT=${PROJECT:-smart-order-469705}
HOST=${HOST:-app.ordertech.me}
DESIRED_IP=${DESIRED_IP:-34.160.231.88}
REGION=${REGION:-me-central1}
SERVICE=${SERVICE:-ordertech}
URL_MAP=${URL_MAP:-smartorder-koobs-map}
BACKEND=${BACKEND:-smartorder-me1-backend}
NEG=${NEG:-ordertech-me1-neg}
CONN_NAME=${CONN_NAME:-smart-order-469705:me-central1:ordertech-db}

warn() { printf "[WARN] %s\n" "$*"; }
info() { printf "[INFO] %s\n" "$*"; }
pass() { printf "[PASS] %s\n" "$*"; }
fail() { printf "[FAIL] %s\n" "$*"; }

SUMMARY=()
ADD_SUM() { SUMMARY+=("$1"); }

# Ensure project
info "Setting gcloud project: ${PROJECT}"
(gcloud config set project "$PROJECT" >/dev/null) || { fail "gcloud config set project failed"; exit 2; }

# 1) DNS check
info "Checking DNS A for ${HOST}"
A_RECORDS=$(dig +short A "$HOST" | paste -sd, -)
if [[ ",$A_RECORDS," == *",${DESIRED_IP},"* ]]; then
  pass "DNS A contains desired IP ${DESIRED_IP} (A=${A_RECORDS})"; ADD_SUM "DNS: OK"
else
  fail "DNS A does not include ${DESIRED_IP} (A=${A_RECORDS:-none})"; ADD_SUM "DNS: MISMATCH"; fi

# 2) URL map default backend for host
info "Describing URL map ${URL_MAP}"
UM_JSON=$(gcloud compute url-maps describe "$URL_MAP" --format=json)
# Find the pathMatcher entry for our host
PM_NAME=$(echo "$UM_JSON" | jq -r --arg host "$HOST" '.hostRules[] | select(.hosts[]? == $host) | .pathMatcher')
if [[ -z "$PM_NAME" || "$PM_NAME" == "null" ]]; then
  fail "No pathMatcher found for host ${HOST} in URL map ${URL_MAP}"; ADD_SUM "URLMAP: NO_RULE"; else
  DSVC=$(echo "$UM_JSON" | jq -r --arg pm "$PM_NAME" '.pathMatchers[] | select(.name==$pm) | .defaultService')
  if [[ "$DSVC" == *"/backendServices/${BACKEND}" ]]; then
    pass "URL map defaultService for ${HOST} pathMatcher=${PM_NAME} is ${BACKEND}"; ADD_SUM "URLMAP: OK"
  else
    fail "URL map defaultService (${DSVC}) does not match ${BACKEND}"; ADD_SUM "URLMAP: WRONG_BACKEND"
  fi
fi

# 3) Backend service uses our NEG
info "Checking backend service ${BACKEND}"
BS_JSON=$(gcloud compute backend-services describe "$BACKEND" --global --format=json)
GROUPS=$(echo "$BS_JSON" | jq -r '.backends[].group')
if echo "$GROUPS" | grep -q "/networkEndpointGroups/${NEG}$"; then
  pass "Backend ${BACKEND} includes NEG ${NEG}"; ADD_SUM "BACKEND: OK"
else
  fail "Backend ${BACKEND} missing NEG ${NEG} (groups: $(echo "$GROUPS" | paste -sd, -))"; ADD_SUM "BACKEND: MISSING_NEG"
fi

# 4) NEG binding to Cloud Run service
info "Checking serverless NEG ${NEG}"
NEG_JSON=$(gcloud compute network-endpoint-groups describe "$NEG" --region="$REGION" --format=json)
NEG_SVC=$(echo "$NEG_JSON" | jq -r '.cloudRun.service // empty')
if [[ "$NEG_SVC" == "$SERVICE" ]]; then
  pass "NEG ${NEG} binds to Cloud Run service ${SERVICE}"; ADD_SUM "NEG: OK"
else
  fail "NEG ${NEG} not bound to ${SERVICE} (found: ${NEG_SVC:-none})"; ADD_SUM "NEG: WRONG_SERVICE"
fi

# 5) Cloud Run service wiring
info "Checking Cloud Run service ${SERVICE} in ${REGION}"
SRV_JSON=$(gcloud run services describe "$SERVICE" --region="$REGION" --format=json)
ANN=$(echo "$SRV_JSON" | jq -r '.spec.template.metadata.annotations["run.googleapis.com/cloudsql-instances"] // ""')
if [[ ",$ANN," == *",${CONN_NAME},"* ]]; then
  pass "Service has Cloud SQL attachment ${CONN_NAME}"; ADD_SUM "CR_SQL: OK"
else
  fail "Service missing Cloud SQL attachment ${CONN_NAME} (ann: ${ANN})"; ADD_SUM "CR_SQL: MISSING"
fi
# DATABASE_URL secret present
HAS_DBURL=$(echo "$SRV_JSON" | jq -r '.spec.template.spec.containers[0].env[]? | select(.name=="DATABASE_URL") | ( .value // .valueFrom.secretKeyRef.name // "" )')
if [[ -n "$HAS_DBURL" ]]; then
  pass "Service maps DATABASE_URL from Secret Manager"; ADD_SUM "CR_SECRET: OK"
else
  fail "Service missing DATABASE_URL mapping"; ADD_SUM "CR_SECRET: MISSING"
fi

# 6) Endpoint probes
# Direct service URL
SRV_URL=$(echo "$SRV_JSON" | jq -r '.status.url')
info "Probing direct service /dbz at ${SRV_URL}"
set +e
DBZ=$(curl -sS "${SRV_URL}/dbz")
set -e
if echo "$DBZ" | jq -e '.ok == true' >/dev/null 2>&1; then
  pass "/dbz ok:true (service)"; ADD_SUM "DBZ: OK"
else
  fail "/dbz failed (service) -> ${DBZ}"; ADD_SUM "DBZ: FAIL"
fi
# LB health
info "Probing LB /health at https://${HOST}/health"
set +e
H=$(curl -sS "https://${HOST}/health" | head -c 200)
RC=$?
set -e
if [[ $RC -eq 0 && "$H" == OK-* ]]; then
  pass "/health OK via LB"; ADD_SUM "LB_HEALTH: OK"
else
  fail "/health unexpected via LB -> ${H}"; ADD_SUM "LB_HEALTH: FAIL"
fi

printf "\n---- Summary ----\n"
for s in "${SUMMARY[@]}"; do echo "- $s"; done

# Exit nonzero if any FAIL marker present
if printf "%s\n" "${SUMMARY[@]}" | grep -q FAIL; then
  exit 1
fi
exit 0

