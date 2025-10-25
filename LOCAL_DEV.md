# Local development quickstart (OrderTech)

This guide helps you run the local server on port 8080 and map hostnames to specific tenants so pages resolve the correct data from Cloud SQL through the Auth Proxy.

Prereqs
- macOS with Homebrew
- Node.js (v18+ suggested)
- Google Cloud SDK (gcloud)
- Cloud SQL Auth Proxy (brew install cloud-sql-proxy)
- Access to project smart-order-469705 and Secret Manager (DATABASE_URL or DB_PASSWORD)

Start the server on port 8080
1) Start the proxy and export DB env (recommended)
   . scripts/dev_db.sh start

2) Start the Node server
   PORT=8080 node server.js

3) Health checks
   - Ready:   http://localhost:8080/readyz (should return READY)
   - DB diag: http://localhost:8080/dbz (JSON with ok: true)

Tenant scoping in local dev
The backend resolves the tenant in this order:
1) X-Tenant-Id header (explicit)
2) tenant_domains mapping by Host header
3) Fallback to DEFAULT_TENANT_ID

Option A — Use a local Host mapping per tenant
1) Map a host to a tenant UUID in the DB:
   # Example: koobs.localhost -> Koobs tenant
   export PGHOST="$HOME/.cloudsql/smart-order-469705:me-central1:ordertech-db"
   export PGPORT=5432
   export PGUSER=ordertech
   export PGDATABASE=smart_order
   export PGPASSWORD=$(gcloud secrets versions access latest --secret=DB_PASSWORD)
   node scripts/add_tenant_domain.js \
     --tenant-id f8578f9c-782b-4d31-b04f-3b2d890c5896 \
     --host koobs.localhost

2) Add host to /etc/hosts:
   127.0.0.1 koobs.localhost

3) Open:
   http://koobs.localhost:8080/products/
   http://koobs.localhost:8080/cashier

Option B — Use X-Tenant-Id in your client requests
   curl -H "x-tenant-id: <TENANT_UUID>" http://localhost:8080/api/categories

Keeping the server running
- Start via helper (spawns proxy and app, sets port 8080):
  scripts/local_up.sh

- Stop:
  scripts/local_down.sh

Notes
- The local default port is 8080. Cloud Run still uses the platform-provided $PORT in production.
- If /api/categories returns [], verify DB env and that your request is tenant-scoped (Host mapping or X-Tenant-Id).
- To seed demo data, use:
  node scripts/seed_from_json.js

