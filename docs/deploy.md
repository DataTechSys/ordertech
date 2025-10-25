# OrderTech Deployment (Production)

This repo includes guardrails so production deploys always target the correct project and region.

Canonical production:
- Project ID: smart-order-469705
- Region: me-central1
- Cloud Run service: ordertech
- Cloud SQL connection: smart-order-469705:me-central1:ordertech-db

One-time setup
1) Authenticate and install CLI
- Install Google Cloud SDK (gcloud)
- gcloud auth login
2) Create and activate the required named configuration and enable APIs
- make gcloud-config

Preflight check (should pass before every deploy)
- make preflight
  - Verifies: active gcloud config is ordertech-prod, project smart-order-469705, region me-central1, and Cloud SQL instance region matches.

Deploy to production
- make deploy
  - You will be asked to type: smart-order-469705/me-central1/ordertech to confirm.

Inspect service
- make describe
- make logs

Troubleshooting
- Active config mismatch
  - gcloud config configurations activate ordertech-prod
- Wrong region
  - gcloud config set run/region me-central1
- Cloud SQL instance not found or wrong region
  - Check config/prod.env and your IAM permissions

Notes
- Scripts source config/prod.env (committed) and do not allow overriding project, region, or service.
- No secrets are stored or printed. DATABASE_URL remains in Secret Manager and is not handled here.
