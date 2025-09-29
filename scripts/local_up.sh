#!/usr/bin/env bash
# Start local Cloud SQL proxy (me-central1:ordertech-db) and launch the OrderTech server on :3000
# - Requires: gcloud logged in with roles/cloudsql.client, cloud-sql-proxy, Node
# - Does not print secrets; reads DATABASE_URL via Secret Manager in a subshell

set -Eeuo pipefail
# Resolve repo root from this script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$SCRIPT_DIR/.."

LOG_DIR=".logs"
mkdir -p "$LOG_DIR"

# Start proxy via provided helper (runs in background and writes a PID file)
# Note: we source to reuse its logic, but env vars set there are not relied upon outside this shell
. "$SCRIPT_DIR/dev_db.sh" start || true

# Launch server with inherited env from this shell session
# We start a fresh subshell that sources dev_db.sh to ensure DB env is set for the node process
(
  set -Eeuo pipefail
  . "$SCRIPT_DIR/dev_db.sh" start
  export NODE_ENV=development
  export PORT=3000
  nohup node server.js > .logs/local_server.log 2>&1 &
  echo $! > .logs/local_server.pid
) || true

echo "[local_up] Started. If this is the first run, ensure /etc/hosts has entries for console.ordertech.me and api.ordertech.me."
