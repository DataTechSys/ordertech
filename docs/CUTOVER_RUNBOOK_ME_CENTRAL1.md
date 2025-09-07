# Cutover runbook: migrate to me-central1

Last updated: 2025-09-01
Project: smart-order-469705

Scope
- Set up Database Migration Service (DMS) for near-zero downtime migration from Cloud SQL Postgres in us-central1 to me-central1
- Validate target
- Switch HTTPS Load Balancer backend to me-central1
- Update CI/CD and secrets
- Rollback steps

Preconditions
- APIs enabled: datamigration.googleapis.com (done)
- Me-central1 Cloud SQL instance: ordertech-db (RUNNABLE), user `ordertech` password set (done)
- Me-central1 Cloud Run job smart-order-migrate executes successfully against me1 DB (done)
- Serverless NEG/backends for me-central1 created and attached; URL map has canary path /_canary (done)

1) DMS setup (Console recommended)
Use the Google Cloud Console → Database Migration Service → Create migration job (PostgreSQL)

- Source connection profile
  - Type: PostgreSQL
  - Connectivity: Cloud SQL instance
  - Instance: smart-order-pg (us-central1)
  - Credentials: username `ordertech` and the current password (same as PGPASSWORD secret)
- Destination connection profile
  - Type: PostgreSQL
  - Connectivity: Cloud SQL instance
  - Instance: smart-order-pg-me1 (me-central1)
  - Credentials: username `ordertech` and the password set in me1 (aligned to PGPASSWORD)
- Migration job
  - Initial dump + continuous data replication (CDC)
  - Migration job region: choose a regional location close to source/destination (us-central1 is fine)
  - Start the job and monitor initial dump
  - After dump completes, ensure CDC is running with small lag

Notes
- If the wizard asks for minimal flags, accept defaults. Cloud SQL PG 15 supports logical decoding; DMS config handles necessary setup.
- Validate row counts for a few key tables in destination.

2) Pre-cutover validation
- Cloud Run (me1) direct URL: gcloud run services describe ordertech --region=me-central1 --format='value(status.url)'
- Validate endpoints: /health, core read APIs, signed uploads (ASSETS_BUCKET configured)
- Warm instances (set min instances in service or hit a few endpoints)

3) Cutover window (target write freeze ~5 minutes)
- Announce read-only window and block writes at app level (e.g., READ_ONLY=true env or a feature flag)
- Wait for DMS CDC lag ~0
- Promote destination (Stop replication / promote in DMS)
- Run migration job on me1 (if not already applied post-changes):
  gcloud run jobs execute migrate-smart-order --region=me-central1 --wait

4) Load Balancer switch to me-central1 backend
- Export URL map, edit path matcher default service, import back

Commands:
- Export current URL map:
  gcloud compute url-maps export smartorder-koobs-map --global --destination=/tmp/urlmap.yaml

- Edit /tmp/urlmap.yaml:
  - Find pathMatchers with name: app-ordertech
  - Change defaultService to:
    https://www.googleapis.com/compute/beta/projects/smart-order-469705/global/backendServices/smartorder-me1-backend

- Import the updated map:
  gcloud compute url-maps import smartorder-koobs-map --global --source=/tmp/urlmap.yaml --quiet

- Validate:
  gcloud compute url-maps describe smartorder-koobs-map --format='yaml(pathMatchers)'

5) Remove write freeze and validate
- Remove READ_ONLY
- Validate traffic paths, error rates, and DB write paths
- Monitor Cloud Run (me1), Cloud SQL (me1), and LB health

6) CI/CD and secrets
- Rotate DATABASE_URL to point to me1 (interactive; does not print secrets):
  bash scripts/setup_db_secret.sh
  # Provide DB user and password when prompted

- Deploy via Cloud Build to me1:
  gcloud builds submit --config=cloudbuild.yaml --substitutions=_SERVICE=ordertech

7) Rollback plan (during canary or after cutover)
- LB rollback:
  - Re-export url map, set pathMatchers: app-ordertech defaultService back to smartorder-ew1-backend, then import
- App/DB rollback:
  - Rotate DATABASE_URL back to original (us-central1), note possible data divergence if writes happened on me1

8) Decommission (after soak)
- Remove DMS artifacts
- Remove old Cloud Run (europe-west1), old Cloud SQL (us-central1) after final backup
- Remove old buckets/NEGs and stale CI references

Checklist
- DMS: Initial dump complete; CDC healthy; destination promoted
- Me1 Cloud Run passes health and key flows; assets bucket ok
- LB switched: production traffic to me1; health checks green
- CI/CD updated; new deploys target me1
- Observability stable; rollback tested during canary

