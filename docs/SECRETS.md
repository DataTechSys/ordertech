# Secrets management — OrderTech (app.ordertech.me)

Project: smart-order-469705

Purpose: Provide a single, durable reference for secret NAMES and safe procedures to create, rotate, and consume them without ever committing or printing secret values. This helps with recovery after incidents or crashes.

Key principles
- Never store secrets in the repo, YAML, or logs. Use Google Secret Manager (GSM).
- Do not echo secrets in terminal. Read them into environment variables and use them directly.
- Cloud Run and Cloud Run Jobs should read secrets via set-secrets; local dev should read from GSM and use the Cloud SQL Auth Proxy.

Source-of-truth secret names
- DATABASE_URL (recommended; used by Cloud Run and migration job)
  - Contains: Postgres connection URL with user, password, db name, and Cloud SQL host path (e.g., host=/cloudsql/PROJECT:REGION:INSTANCE)
  - Consumers: Cloud Run service smart-order (europe-west1), Cloud Run Job migrate-db, scripts/migrate.js, scripts/run_sql.js
- DB_PASSWORD (optional; local development convenience)
  - Contains: Database password only (use with scripts/dev_db.sh and DB_USER/DB_NAME)

Create/rotate DATABASE_URL (no values printed)
1) Ensure project
   gcloud config set project smart-order-469705
2) Create the secret (one-time; ignore error if it exists)
   gcloud secrets create DATABASE_URL --replication-policy=automatic || true
3) Build URL safely and add a new version (paste password only at the hidden prompt)
   read -p "DB user: " DB_USER
   read -s -p "DB password (hidden): " DB_PASS; echo
   DB_NAME="smart_order"
   INSTANCE="smart-order-469705:us-central1:smart-order-pg"
   DATABASE_URL=$(node -e 'const e=encodeURIComponent; const u=process.env; const url=`postgres://${e(u.DB_USER)}:${e(u.DB_PASS)}@/${e(u.DB_NAME)}?host=/cloudsql/${u.INSTANCE}`; process.stdout.write(url);' \
     DB_USER="$DB_USER" DB_PASS="$DB_PASS" DB_NAME="$DB_NAME" INSTANCE="$INSTANCE")
   printf "%s" "$DATABASE_URL" | gcloud secrets versions add DATABASE_URL --data-file=-
   unset DB_USER DB_PASS DATABASE_URL

Grant Cloud Run runtime access
- Determine the service account (SA) used by the smart-order service:
  RUNTIME_SA="$(gcloud run services describe smart-order --region=europe-west1 \
    --format='value(spec.template.spec.serviceAccountName)')"
- Grant access:
  gcloud secrets add-iam-policy-binding DATABASE_URL \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor"

Wire DATABASE_URL into Cloud Run (service)
- Ensure the secret is mapped and Cloud SQL instance is attached:
  gcloud run services update smart-order \
    --region=europe-west1 \
    --set-secrets=DATABASE_URL=DATABASE_URL:latest \
    --add-cloudsql-instances=smart-order-469705:us-central1:smart-order-pg

Cloud Run Job for migrations
- The CI pipeline (cloudbuild.yaml) updates/creates a migrate-db job that runs scripts/migrate.js with:
  --set-secrets DATABASE_URL=DATABASE_URL:latest
  --add-cloudsql-instances smart-order-469705:us-central1:smart-order-pg

Local development (Cloud SQL Auth Proxy)
Option A — Use full DATABASE_URL from GSM (simplest)
- Create scripts/dev_db.env (not committed) with:
  PROJECT_ID=smart-order-469705
  REGION=europe-west1
  CONNECTION_NAME=smart-order-469705:us-central1:smart-order-pg
  DB_URL_SECRET=DATABASE_URL
- Usage:
  . scripts/dev_db.sh
  start
  status
  # The script sets DATABASE_URL and REQUIRE_DB=1 for the current shell
  # Run:
  npm start
  # When done:
  stop

Option B — Use DB_PASSWORD for a constructed local URL
- Create scripts/dev_db.env (not committed) with:
  PROJECT_ID=smart-order-469705
  REGION=europe-west1
  CONNECTION_NAME=smart-order-469705:us-central1:smart-order-pg
  DB_USER=ordertech
  DB_NAME=smart_order
  DB_PASSWORD_SECRET=DB_PASSWORD
- Usage:
  . scripts/dev_db.sh
  start
  npm start
  stop

Recovery after incidents (no printing)
- Retrieve and use DATABASE_URL without echoing its value:
  DB_URL=$(gcloud secrets versions access latest --secret=DATABASE_URL)
  export DATABASE_URL="$DB_URL"
  # Example: run a read-only check
  printf "SELECT current_database(), now();\n" | node scripts/run_sql.js
  unset DB_URL
- Or with psql via proxy (password-only secret):
  PGPASSWORD=$(gcloud secrets versions access latest --secret=DB_PASSWORD)
  export PGPASSWORD
  psql -h 127.0.0.1 -p 5432 -U ordertech -d smart_order -c "select now();"
  unset PGPASSWORD

Security notes
- Do not commit secrets or plaintext backups. Restrict access to any generated files that may contain secrets (e.g., server_data); rotate secrets if exposure is suspected.
- Ensure least-privilege access to secrets and Cloud SQL (use roles/secretmanager.secretAccessor and roles/cloudsql.client as needed).
- Prefer staging environments for risky operations.

