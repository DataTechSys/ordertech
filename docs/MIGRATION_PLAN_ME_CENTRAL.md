# OrderTech migration plan: to me-central (Dammam or Doha)

Last updated: 2025-09-01T10:55:58Z
Owner: mosawi
Project: smart-order-469705
Domain: app.ordertech.me (HTTPS LB IP: 34.160.231.88)

Purpose
- Move Cloud Run, Cloud SQL, GCS assets, and related runtime configuration into me-central (prefer me-central2 for KSA/Kuwait; use me-central1 if Qatar dominates and latency is materially better).
- Keep the same public IP and DNS via the existing global HTTPS Load Balancer; only switch backend to a serverless NEG pointing to the new me-central Cloud Run service.
- Achieve near-zero downtime using Database Migration Service (continuous replication) with a short write-freeze at cutover.

Current known state (from repo)
- Cloud Run (prod): ordertech in me-central1 (LB backend via serverless NEG); URL in docs/PROJECT_CONTEXT.md
- Cloud SQL (prod): smart-order-469705:me-central1:ordertech-db (primary)
- HTTPS LB (global): IP 34.160.231.88 with managed cert for app.ordertech.me; URL map smartorder-koobs-map (names in docs)
- Secret Manager: DATABASE_URL used by service and job; PGPASSWORD present in CI; scripts/setup_db_secret.sh standardizes DATABASE_URL
- GCS assets: ASSETS_BUCKET env consumed by @google-cloud/storage for signed URLs (/admin/upload-url)
- CI/CD: cloudbuild.yaml targets me-central1 (service: ordertech) and runs the migrate-smart-order job; the DATABASE_URL secret points to me-central1 Cloud SQL (ordertech-db)
- WebRTC ICE/TURN: supports ICE_SERVERS_JSON or TURN_URLS/USERNAME/PASSWORD; Twilio fallback supported

High-level phases
1) Inventory & validation (read-only)
2) Region selection by quick latency checks (default: me-central2)
3) Stand up Cloud SQL in TARGET_REGION (same major version, extensions)
4) Standardize secrets (DATABASE_URL -> TARGET_REGION)
5) Deploy Cloud Run service + migration job in TARGET_REGION
6) Artifact Registry strategy (prefer TARGET_REGION if supported)
7) Migrate GCS assets to TARGET_REGION and update ASSETS_BUCKET
8) Set up Database Migration Service (continuous replication)
9) Pre-cutover validation (direct service URL)
10) Add serverless NEG in TARGET_REGION and wire LB canary
11) Cutover (write-freeze, promote target, run migrations, LB switch)
12) Post-cutover validation and soak
13) Update CI/CD
14) Optional: Self-hosted TURN (coturn) in TARGET_REGION
15) Rollback plan
16) Security/IAM parity
17) Documentation
18) Decommission legacy resources (after soak)
19) Acceptance checklist

Detailed plan and commands

0) Preconditions, access, and API enablement
- Required roles (or equivalent): run.admin, compute.admin, sql.admin, storage.admin, secretmanager.admin, artifactregistry.admin, cloudbuild.builds.editor, monitoring.editor, logging.admin, datamigration.admin
- Enable APIs (once):
  gcloud config set project smart-order-469705
  gcloud services enable run.googleapis.com sqladmin.googleapis.com datamigration.googleapis.com compute.googleapis.com artifactregistry.googleapis.com storage.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com logging.googleapis.com monitoring.googleapis.com
- Quotas: verify Cloud SQL CPU/storage, Cloud Run, NEGs, DMS in me-central1/2
- Plan a 30–60 min maintenance window; expected write-freeze < 5 minutes

1) Inventory & validation (read-only)
- Save current service/job config (image, cpu/mem, concurrency, min/max, env, SA, Cloud SQL attachments)
- Save Cloud SQL instance describe (version, tier, storage, flags)
- Save Secret Manager metadata (DATABASE_URL)
- Save Artifact Registry repos and GCS buckets
- Save LB components: forwarding rules, URL maps, backends, NEGs, certs
- Save region availability for Cloud Run, Cloud SQL, Artifact Registry in me-central

2) Region selection by latency (me-central2 vs me-central1)
- Deploy temporary echo services in both regions; collect p50/p95 latency from Middle East probes (Riyadh, Jeddah, Kuwait City, Doha)
- Rule: choose me-central2 for KSA/KW unless me-central1 significantly wins for your users; otherwise choose me-central1
- Set: export TARGET_REGION=me-central2 (or me-central1)

3) Prepare Cloud SQL (target) in TARGET_REGION
- Create Cloud SQL Postgres with same major version and comparable tier/storage
- Set flags for CDC if needed: wal_level=logical, max_replication_slots, max_wal_senders
- Create database(s) and users to match source (e.g., smart_order, user ordertech)
- Enable needed extensions: pgcrypto, uuid-ossp, etc.

4) Standardize secrets & IAM
- Use one Secret Manager entry: DATABASE_URL -> postgresql://ordertech:REDACTED@/smart_order?host=/cloudsql/smart-order-469705:$TARGET_REGION:smart-order-pg
- Rotate a new version and grant runtime SA: roles/secretmanager.secretAccessor, roles/cloudsql.client (and storage permissions for new bucket later)
- Keep legacy PGPASSWORD only for rollback period, then retire

5) Prepare Cloud Run service and job in TARGET_REGION
- Deploy smart-order in TARGET_REGION with:
  - add-cloudsql-instances=smart-order-469705:$TARGET_REGION:smart-order-pg
  - set-secrets=DATABASE_URL=DATABASE_URL:latest
  - set-env-vars=ASSETS_BUCKET=gs://NEW_BUCKET_NAME, PORT=8080, plus existing non-secret env
  - cpu/memory/concurrency/min/max matched to current prod
- Create migration job (migrate-smart-order) in TARGET_REGION with same image + DATABASE_URL secret

6) Artifact Registry strategy
- Prefer a docker repo in TARGET_REGION if available; else continue using us-central1 registry (Cloud Run pulls cross-region fine)

7) Migrate GCS assets
- Create a regional bucket in TARGET_REGION (gs://NEW_BUCKET_NAME)
- rsync objects from old bucket to the new one
- Apply CORS for app.ordertech.me; grant runtime SA access
- Update Cloud Run env ASSETS_BUCKET accordingly

8) Database Migration Service (near-zero downtime)
- Create source/destination profiles and a continuous migration job (initial dump + CDC)
- Monitor initial load and lag; validate sample row counts

9) Pre-cutover validation
- Directly test TARGET_REGION Cloud Run URL: /health, /dbz, key flows, signed uploads to NEW_BUCKET
- Pre-warm instances (min-instances > 0)

10) LB wiring (serverless NEG)
- Create a serverless NEG for TARGET_REGION service
- Either add a canary backend and map /_canary path for on-LB testing, or attach NEG to existing backend with capacity-scaler=0.0 initially

11) Cutover runbook
- T-15: Announce read-only window; set READ_ONLY=true or equivalent to block writes
- Confirm DMS lag ~0; stop writes; promote destination (stop CDC)
- Rotate DATABASE_URL (if not already) to TARGET_REGION; run migration job on target
- Switch LB backend capacity to TARGET_REGION NEG to 1.0 and drain europe-west1 to 0.0
- Remove READ_ONLY

12) Post-cutover validation & soak
- Validate health and critical paths; monitor Cloud Run, Cloud SQL, LB
- Keep DMS artifacts for audit; keep source infra for 1–2 weeks

13) CI/CD (Cloud Build) updates
- Change substitutions: _REGION=$TARGET_REGION; _AR_LOCATION=$TARGET_REGION if supported; fix hardcoded us-central1/europe-west1
- Ensure deploy & job steps use DATABASE_URL secret and add-cloudsql-instances for $TARGET_REGION

14) Optional: Self-hosted TURN (coturn)
- Deploy a small GCE VM in TARGET_REGION with static IP; configure coturn and firewall
- Set TURN_URLS, TURN_USERNAME, TURN_PASSWORD env vars; validate /webrtc/config
- Keep Twilio fallback until stable

15) Rollback plan
- LB: reduce TARGET_REGION capacity-scaler to 0.0 and restore europe-west1 to 1.0
- App/DB: rotate DATABASE_URL back to source; note data divergence risk if new DB accepted writes
- Keep original infra for 7–14 days

16) Security/IAM parity
- Ensure runtime SA, roles, and any VPC connector settings match in TARGET_REGION
- Certs remain on the global LB; ensure status stays ACTIVE

17) Documentation
- Update architecture, runbooks for DMS cutover, LB backend switch, and rollback

18) Decommission legacy resources (after soak)
- Remove DMS, old Cloud Run in europe-west1, old Cloud SQL in us-central1 (after final backup), old bucket, old serverless NEG, and old CI refs

19) Acceptance checklist
- Region choice based on measured latency; TARGET_REGION set
- Cloud SQL target healthy with required extensions and flags
- DATABASE_URL used consistently by service and migration job; secrets and IAM in place
- Cloud Run service and job in TARGET_REGION pass direct tests; assets bucket migrated
- DMS replication healthy; cutover completed with <5 min write-freeze
- LB switched to TARGET_REGION; IP and cert unchanged; health checks green
- CI/CD updated; new deploys target TARGET_REGION
- Observability stable post-cutover; rollback tested during canary

Appendix: repo references
- cloudbuild.yaml (update _REGION, _AR_LOCATION, Cloud SQL connection names)
- scripts/setup_db_secret.sh (rotate DATABASE_URL)
- scripts/dev_db.* (local proxy helpers)
- docs/PROJECT_CONTEXT.md, docs/OPERATIONS.md (LB, domain, links)
- server.js (ASSETS_BUCKET, TURN/Twilio env usage)

