#!/usr/bin/env bash
# generate_server_data.sh — Consolidated prod profile for app.ordertech.me (includes plaintext secrets)
# WARNING: This writes plaintext secrets to ./server_data. Handle and store securely.

set -euo pipefail

# Defaults (overridable via environment)
PROJECT="${PROJECT:-smart-order-469705}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-smart-order}"
HOST="${HOST:-app.ordertech.me}"
DESIRED_IP="${DESIRED_IP:-34.160.231.88}"
REPO_ROOT="${REPO_ROOT:-$(pwd)}"
OUTFILE="${OUTFILE:-${REPO_ROOT}/server_data}"

umask 077

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1"; exit 1; }; }

for c in gcloud jq curl dig; do require_cmd "$c"; done
if ! command -v psql >/dev/null 2>&1; then
  echo "Note: psql not found; DB connectivity/migration checks will be limited." >&2
fi

mkdir -p "$(dirname "$OUTFILE")"
: > "$OUTFILE"

w() { printf "%s\n" "$*" >> "$OUTFILE"; }
hr() { w "--------------------------------------------------------------------------------"; }

NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
EXEC_USER="$(whoami || id -un || echo unknown)"
HOST_SYS="$(hostname || scutil --get LocalHostName || echo unknown)"

# Set gcloud project for all subsequent calls
set +e
gcloud config set project "$PROJECT" >/dev/null 2>&1
set -e

section_header() { hr; w "$1"; hr; }

# 1) Header
section_header "1) Header - Timestamp (UTC), executing user, machine hostname, Project: ${PROJECT}, Hostname: ${HOST} (Prod)"
w "Timestamp (UTC): ${NOW}"
w "Executing user: ${EXEC_USER}"
w "Machine hostname: ${HOST_SYS}"
w "Project: ${PROJECT}"
w "Hostname: ${HOST} (Prod)"

# 2) DNS
section_header "2) DNS for ${HOST}"
DNS_A="$(dig +short A "${HOST}" | paste -sd, -)"
DNS_CNAME="$(dig +short CNAME "${HOST}" | paste -sd, -)"
w "Current A records: ${DNS_A:-none}"
w "Current CNAME records: ${DNS_CNAME:-none}"
w "Desired A: ${DESIRED_IP}"
if [[ ",${DNS_A}," == *",${DESIRED_IP},"* ]]; then w "Status: MATCH (desired IP present in A records)"; else w "Status: MISMATCH (desired IP not present)"; fi

basename_gcp() { local ref="$1"; echo "${ref##*/}"; }

# 3) HTTPS Load Balancer (Prod path only)
section_header "3) HTTPS Load Balancer (Prod path only)"
w "Looking for forwarding rules using IP ${DESIRED_IP} ..."
FR_JSON="$(gcloud compute forwarding-rules list --global --format=json || echo '[]')"
MATCH_FR="$(echo "$FR_JSON" | jq -c --arg ip "$DESIRED_IP" '.[] | select(.IPAddress==$ip)')"
if [[ -z "$MATCH_FR" ]]; then
  w "No forwarding rules found with IP ${DESIRED_IP}. Listing all global HTTP(S) forwarding rules for context:"
  echo "$FR_JSON" | jq -r '.[] | select(.IPProtocol=="TCP") | "- FR: \(.name) | IP: \(.IPAddress) | Ports: \(.portRange) | Target: \(.target)"' >> "$OUTFILE"
else
  echo "$MATCH_FR" | jq -r '"- FR: \(.name) | IP: \(.IPAddress) | Ports: \(.portRange) | Target: \(.target)"' >> "$OUTFILE"
fi

URLMAPS=(); CERTS=()
if [[ -n "$MATCH_FR" ]]; then
  while IFS= read -r fr; do
    TARGET="$(echo "$fr" | jq -r '.target')"
    if [[ "$TARGET" == *"/targetHttpsProxies/"* ]]; then
      PROXY_NAME="$(basename_gcp "$TARGET")"
      PROXY_DESC="$(gcloud compute target-https-proxies describe "$PROXY_NAME" --format=json || echo '{}')"
      URLMAP_REF="$(echo "$PROXY_DESC" | jq -r '.urlMap // empty')"
      URLMAP_NAME="$(basename_gcp "$URLMAP_REF")"; [[ -n "$URLMAP_NAME" ]] && URLMAPS+=("$URLMAP_NAME")
      while read -r certRef; do [[ -n "$certRef" ]] && CERTS+=("$(basename_gcp "$certRef")"); done < <(echo "$PROXY_DESC" | jq -r '.sslCertificates[]? // empty')
    elif [[ "$TARGET" == *"/targetHttpProxies/"* ]]; then
      PROXY_NAME="$(basename_gcp "$TARGET")"
      PROXY_DESC="$(gcloud compute target-http-proxies describe "$PROXY_NAME" --format=json || echo '{}')"
      URLMAP_REF="$(echo "$PROXY_DESC" | jq -r '.urlMap // empty')"
      URLMAP_NAME="$(basename_gcp "$URLMAP_REF")"; [[ -n "$URLMAP_NAME" ]] && URLMAPS+=("$URLMAP_NAME")
    fi
  done < <(echo "$MATCH_FR" | jq -c '.')
fi
URLMAPS_UNIQ_STR="$(printf "%s\n" "${URLMAPS[@]:-}" | awk 'NF && !seen[$0]++')"
CERTS_UNIQ_STR="$(printf "%s\n" "${CERTS[@]:-}" | awk 'NF && !seen[$0]++')"

w "Public IP (from forwarding rules): ${DESIRED_IP}"

FOUND_MAP=""; FOUND_PATHMATCHER=""; FOUND_BACKEND=""
IFS=$'\n'
for um in $URLMAPS_UNIQ_STR; do
  [[ -z "$um" ]] && continue
  UM_DESC="$(gcloud compute url-maps describe "$um" --format=json || echo '{}')"
  MATCHING_RULE="$(echo "$UM_DESC" | jq -c --arg host "$HOST" '.hostRules[]? | select(.hosts[]? == $host)')"
  if [[ -n "$MATCHING_RULE" ]]; then
    FOUND_MAP="$um"
    PM_NAME="$(echo "$MATCHING_RULE" | jq -r '.pathMatcher')"; FOUND_PATHMATCHER="$PM_NAME"
    w "URL map that matches ${HOST}: ${FOUND_MAP} (pathMatcher: ${FOUND_PATHMATCHER})"
    PM_JSON="$(echo "$UM_DESC" | jq -c --arg pm "$PM_NAME" '.pathMatchers[] | select(.name==$pm)')"
    DEFAULT_SVC="$(echo "$PM_JSON" | jq -r '.defaultService // empty')"
    if [[ -n "$DEFAULT_SVC" ]]; then
      FOUND_BACKEND="$(basename_gcp "$DEFAULT_SVC")"
      w "Backend service (default for host): ${FOUND_BACKEND}"
    else
      w "Path rules:"; echo "$PM_JSON" | jq -r '.pathRules[]? | "- paths: \(.paths|join(",")) -> \(.service)"' >> "$OUTFILE"
      FIRST_BACK="$(echo "$PM_JSON" | jq -r '.pathRules[0]?.service // empty')"
      [[ -n "$FIRST_BACK" ]] && FOUND_BACKEND="$(basename_gcp "$FIRST_BACK")"
    fi
    break
  fi
done
unset IFS

if [[ -z "$FOUND_MAP" ]]; then
  w "No URL map host rule explicitly matched ${HOST}. Listing discovered URL maps for manual inspection:"
  printf "%s\n" "$URLMAPS_UNIQ_STR" | sed 's/^/- URL map: /' >> "$OUTFILE"
fi

if [[ -n "$FOUND_BACKEND" ]]; then
  BS_DESC="$(gcloud compute backend-services describe "$FOUND_BACKEND" --global --format=json || echo '{}')"
  w "Backend service: ${FOUND_BACKEND}"
  echo "$BS_DESC" | jq -r '.loadBalancingScheme as $l | "- LB scheme: \($l)"' >> "$OUTFILE"
  echo "$BS_DESC" | jq -r '.backends[]? | "- backend group: \(.group)"' >> "$OUTFILE"
  while read -r grp; do
    [[ -z "$grp" ]] && continue
    NEG_NAME="$(basename_gcp "$grp")"
    NEG_DESC="$(gcloud compute network-endpoint-groups describe "$NEG_NAME" --global --format=json || echo '{}')"
    NEG_TYPE="$(echo "$NEG_DESC" | jq -r '.networkEndpointType // empty')"
    w "NEG ${NEG_NAME} type: ${NEG_TYPE}"
    if [[ "$NEG_TYPE" == "SERVERLESS" ]]; then
      echo "$NEG_DESC" | jq -r '.cloudRun as $cr | "- Cloud Run service: \($cr.service // "unknown") | tag: \($cr.tag // "none") | urlMask: \($cr.urlMask // "none")"' >> "$OUTFILE"
    fi
  done < <(echo "$BS_DESC" | jq -r '.backends[]? | .group // empty')
fi

if [ -n "$CERTS_UNIQ_STR" ]; then
  w "Managed certs attached to target HTTPS proxy:"
  IFS=$'\n'
  for cert in $CERTS_UNIQ_STR; do
    [[ -z "$cert" ]] && continue
    C_DESC="$(gcloud compute ssl-certificates describe "$cert" --format=json || echo '{}')"
    DOMAINS="$(echo "$C_DESC" | jq -r '.managed.domains[]? | @text' | paste -sd, -)"
    STATUS="$(echo "$C_DESC" | jq -r '.managed.status // .type // "unknown"')"
    w "- ${cert}: status=${STATUS}; domains=${DOMAINS:-none}"
  done
  unset IFS
else
  w "No ssl-certificates discovered from forwarding rules. If Certificate Manager is used, listing certs:"
  CERTM_LIST="$(gcloud certificate-manager certificates list --format=json || echo '[]')"
  if [[ "$CERTM_LIST" != "[]" ]]; then
    echo "$CERTM_LIST" | jq -r '.[] | "- cert: \(.name) | san: \(.sanDnsnames|join(",")) | type: \(.type) | scope: \(.scope)"' >> "$OUTFILE"
  fi
fi

# 4) Cloud Run service (Prod)
section_header "4) Cloud Run service (Prod)"
SRV_JSON="$(gcloud run services describe "$SERVICE" --region "$REGION" --format=json || echo '{}')"
SRV_URL="$(echo "$SRV_JSON" | jq -r '.status.url // empty')"
IMG="$(echo "$SRV_JSON" | jq -r '.spec.template.spec.containers[0].image // empty')"
REV_CREATED="$(echo "$SRV_JSON" | jq -r '.status.latestCreatedRevisionName // empty')"
REV_READY="$(echo "$SRV_JSON" | jq -r '.status.latestReadyRevisionName // empty')"
PORT="$(echo "$SRV_JSON" | jq -r '.spec.template.spec.containers[0].ports[0].containerPort // 8080')"
CONCURRENCY="$(echo "$SRV_JSON" | jq -r '.spec.template.spec.containerConcurrency // "default(80)"')"
MIN_SCALE="$(echo "$SRV_JSON" | jq -r '.spec.template.metadata.annotations["autoscaling.knative.dev/minScale"] // "not set"')"
MAX_SCALE="$(echo "$SRV_JSON" | jq -r '.spec.template.metadata.annotations["autoscaling.knative.dev/maxScale"] // "not set"')"
SQL_INSTANCES_ANN="$(echo "$SRV_JSON" | jq -r '.spec.template.metadata.annotations["run.googleapis.com/cloudsql-instances"] // empty')"

w "Service name: ${SERVICE} (region ${REGION})"
w "Service URL: ${SRV_URL}"
w "Image: ${IMG}"
w "Latest revision (created): ${REV_CREATED}"
w "Latest revision (ready): ${REV_READY}"
w "Port: ${PORT}"
w "Concurrency: ${CONCURRENCY}"
w "Min instances: ${MIN_SCALE}"
w "Max instances: ${MAX_SCALE}"
w "Cloud SQL attachments (annotation run.googleapis.com/cloudsql-instances): ${SQL_INSTANCES_ANN:-none}"

# Environment variables with resolved secret values
w "Environment variables (name -> value):"
ENV_JSON_ARRAY="$(echo "$SRV_JSON" | jq -c '.spec.template.spec.containers[0].env // []')"
DB_URL=""
MIG_URL=""
SECRET_SOURCES_STR=""

if [[ "$ENV_JSON_ARRAY" != "[]" ]]; then
  while IFS= read -r env; do
    NAME="$(echo "$env" | jq -r '.name')"
    VAL="$(echo "$env" | jq -r '.value // empty')"
    RESVAL=""
    if [[ -n "$VAL" ]]; then
      RESVAL="$VAL"
    else
      SEC_NAME="$(echo "$env" | jq -r '.valueSource.secretKeyRef.secret // empty | values')"
      SEC_VER="$(echo "$env" | jq -r '.valueSource.secretKeyRef.version // "latest"')"
      if [[ -z "$SEC_NAME" ]]; then
        SEC_NAME="$(echo "$env" | jq -r '.valueFrom.secretKeyRef.name // empty | values')"
        SEC_VER="$(echo "$env" | jq -r '.valueFrom.secretKeyRef.key // "latest"')"
      fi
      if [[ -n "$SEC_NAME" ]]; then
        set +e
        SEC_VAL="$(gcloud secrets versions access "$SEC_VER" --secret="$SEC_NAME" --project="$PROJECT" 2>/dev/null)"
        RES=$?
        set -e
        if [[ $RES -ne 0 ]]; then
          RESVAL="<<ERROR: unable to access secret ${SEC_NAME}:${SEC_VER}>>"
        else
          RESVAL="$SEC_VAL"
          SECRET_SOURCES_STR+="${SEC_NAME}|${SEC_VER}\n"
        fi
      else
        RESVAL="<<unresolved>>"
      fi
    fi
    printf "%s -> %s\n" "$NAME" "$RESVAL" >> "$OUTFILE"
    if [[ "$NAME" == "DATABASE_URL" && -z "$DB_URL" ]]; then DB_URL="$RESVAL"; fi
    if [[ "$NAME" == "MIGRATIONS_URL" && -z "$MIG_URL" ]]; then MIG_URL="$RESVAL"; fi
  done < <(echo "$ENV_JSON_ARRAY" | jq -c '.[]')
fi

# 5) Secrets (with values)
section_header "5) Secrets (with values)"
if [[ -n "$SECRET_SOURCES_STR" ]]; then
  w "Secrets referenced by Cloud Run env (Secret Manager current values):"
  UNIQUE_SECS="$(printf "%b" "$SECRET_SOURCES_STR" | awk 'NF && !seen[$0]++')"
  IFS=$'\n'
  for line in $UNIQUE_SECS; do
    s="${line%%|*}"
    VER="${line#*|}"
    set +e
    VAL="$(gcloud secrets versions access "$VER" --secret="$s" --project="$PROJECT" 2>/dev/null)"
    RES=$?
    set -e
    if [[ $RES -ne 0 ]]; then VAL="<<ERROR: unable to access secret ${s}:${VER}>>"; fi
    w "- ${s} (version ${VER}): ${VAL}"
    if [[ "$s" == "DATABASE_URL" && -z "$DB_URL" ]]; then DB_URL="$VAL"; fi
    if [[ "$s" == "MIGRATIONS_URL" && -z "$MIG_URL" ]]; then MIG_URL="$VAL"; fi
  done
  unset IFS
else
  w "No Cloud Run env-bound Secret Manager references detected."
fi

if [[ -n "${DB_URL}" ]]; then
  w ""
  w "DATABASE_URL breakdown:"
  python3 - "$DB_URL" >> "$OUTFILE" << 'PY'
import sys
from urllib.parse import urlparse, unquote
u = sys.argv[1]
p = urlparse(u)
def s(x): return "" if x is None else str(x)
print(f"- protocol: {p.scheme}")
print(f"- user: {unquote(s(p.username))}")
print(f"- password: {unquote(s(p.password))}")
print(f"- host: {s(p.hostname)}")
print(f"- port: {s(p.port)}")
print(f"- database: {p.path.lstrip('/')}")
PY
else
  w "DATABASE_URL: not found in env or secrets"
fi

if [[ -n "${MIG_URL}" ]]; then
  w ""
  w "MIGRATIONS_URL: ${MIG_URL}"
fi

# 6) Database (Cloud SQL Postgres)
section_header "6) Database (Cloud SQL Postgres)"
if [[ -n "$SQL_INSTANCES_ANN" ]]; then
  IFS=',' read -r -a INSTS <<< "$SQL_INSTANCES_ANN"
  for conn in "${INSTS[@]}"; do
    conn_trim="$(echo "$conn" | xargs)"; [[ -z "$conn_trim" ]] && continue
    w "Instance connection: ${conn_trim}"
    IFS=':' read -r prj reg inst <<< "$conn_trim"; inst="${inst:-$conn_trim}"
    DESC="$(gcloud sql instances describe "$inst" --project="$PROJECT" --format=json || echo '{}')"
    REGION_SQL="$(echo "$DESC" | jq -r '.region // empty')"
    DBV="$(echo "$DESC" | jq -r '.databaseVersion // empty')"
    TIER="$(echo "$DESC" | jq -r '.settings.tier // empty')"
    AUTOSCALE="$(echo "$DESC" | jq -r '.settings.storageAutoResize // empty')"
    STORAGE_SIZE="$(echo "$DESC" | jq -r '.settings.dataDiskSizeGb // empty')"
    w "- region: ${REGION_SQL}"
    w "- databaseVersion: ${DBV}"
    w "- tier: ${TIER}"
    w "- storageAutoResize: ${AUTOSCALE}"
    w "- dataDiskSizeGb: ${STORAGE_SIZE}"
    w "Databases:"; gcloud sql databases list --instance="$inst" --project="$PROJECT" --format="value(name)" 2>/dev/null | sed 's/^/  - /' >> "$OUTFILE" || w "  - (no list)"
    w "Users:"; gcloud sql users list --instance="$inst" --project="$PROJECT" --format="value(name)" 2>/dev/null | sed 's/^/  - /' >> "$OUTFILE" || w "  - (no list)"
  done
else
  w "No Cloud SQL instance attachment annotation found on the Cloud Run service."
fi

if command -v psql >/dev/null 2>&1 && [[ -n "${DB_URL:-}" ]]; then
  w "Connectivity check via psql:"
  set +e
  psql "${DB_URL}" -v ON_ERROR_STOP=1 -c "select now() as db_time_utc, current_database() as db, current_user as user;" >> "$OUTFILE" 2>&1
  RES=$?
  set -e
  if [[ $RES -ne 0 ]]; then w "psql connectivity check FAILED."; else w "psql connectivity check OK."; fi
else
  w "Skipping psql connectivity check (psql not found or DATABASE_URL missing)."
fi

w "Schema/migrations:"
if [[ -d "${REPO_ROOT}/migrations" ]]; then
  w "Local migration SQL files in ${REPO_ROOT}/migrations:"; find "${REPO_ROOT}/migrations" -type f -name '*.sql' -maxdepth 2 | sed 's/^/  - /' >> "$OUTFILE"
else
  w "migrations/ directory not found at ${REPO_ROOT}/migrations"
fi

if command -v psql >/dev/null 2>&1 && [[ -n "${DB_URL:-}" ]]; then
  w "Applied migrations/tables (best-effort):"
  psql "${DB_URL}" -v ON_ERROR_STOP=0 -tAc "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_name ILIKE '%migration%';" 2>/dev/null | sed 's/^/  - /' >> "$OUTFILE" || true
  for tbl in prisma_migrations schema_migrations goose_db_version knex_migrations flyway_schema_history __diesel_schema_migrations; do
    set +e
    EXISTS="$(psql "${DB_URL}" -tAc "SELECT to_regclass('public.${tbl}')" 2>/dev/null | tr -d '[:space:]')"
    set -e
    if [[ "$EXISTS" == "public.${tbl}" ]]; then
      w "Contents of ${tbl} (up to 100 rows):"; psql "${DB_URL}" -v ON_ERROR_STOP=0 -qAt -c "SELECT * FROM ${tbl} LIMIT 100;" 2>/dev/null >> "$OUTFILE" || true
    fi
  done
fi

# 7) Application endpoints (Prod)
section_header "7) Application endpoints (Prod)"
check_url() { local path="$1"; local url="https://${HOST}${path}"; local code; code="$(curl -s -o /dev/null -w "%{http_code}" "$url")"; printf "%-30s -> HTTP %s\n" "$url" "$code" >> "$OUTFILE"; }
check_url "/"; check_url "/health"; check_url "/api/health"; check_url "/healthz"; check_url "/api/healthz"; check_url "/admin"

w ""; w "Tenant resolution by host via tenant_domains (best-effort sample):"
if command -v psql >/dev/null 2>&1 && [[ -n "${DB_URL:-}" ]]; then
  set +e
  psql "${DB_URL}" -v ON_ERROR_STOP=0 -c "SELECT host as domain, tenant_id FROM tenant_domains ORDER BY domain LIMIT 50;" >> "$OUTFILE" 2>/dev/null
  set -e
else
  w "(skipped; psql or DATABASE_URL not available)"
fi

# 8) Notes and caveats
section_header "8) Notes and caveats"
if [[ -n "$FOUND_BACKEND" ]]; then w "Prod traffic for ${HOST} maps to URL map ${FOUND_MAP} and backend ${FOUND_BACKEND}."; else w "Could not conclusively map ${HOST} to a backend service from URL maps discovered via forwarding rules."; fi
if [[ -n "$SRV_URL" ]]; then w "Cloud Run service URL: ${SRV_URL} (region ${REGION}). Ensure LB backend NEG points to this service."; fi
if [[ ",${DNS_A}," == *",${DESIRED_IP},"* ]]; then w "DNS A record matches desired IP ${DESIRED_IP}."; else w "DNS A record does NOT match desired IP ${DESIRED_IP}."; fi
w "This file includes plaintext secret values. File permissions set via umask 077; verify with: ls -l ${OUTFILE}"

