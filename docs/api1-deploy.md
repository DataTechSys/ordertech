# App API (api1) deployment

This folder contains a helper script to deploy the device-facing read API (api1) to Cloud Run. The service proxies requests to the Admin origin and adds caching/ETag headers optimized for iOS clients.

- Source: DisplayApp/server/api1
- Default service name: ordertech-api1
- Default region: me-central1

Prerequisites
- gcloud CLI authenticated
- Project: smart-order-469705
- Region: me-central1

Deploy

```
# optional overrides
export PROJECT_ID=smart-order-469705
export REGION=me-central1

# deploy
scripts/deploy_api1.sh

# or with a custom service name
scripts/deploy_api1.sh ordertech-api1
```

Post-deploy
- Point DNS api1.ordertech.me to the HTTPS Global Load Balancer IP and route host to the Cloud Run backend via a serverless NEG.
- Ensure ADMIN_BASE env points to https://app.ordertech.me (the script sets this by default).
- Health check: GET /healthz should return "ok".
