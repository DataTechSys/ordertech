# Operations: Smart Order

This cheat sheet helps quickly re-derive deployment context and perform routine operations.

Project: smart-order-469705

## DNS

- Check current DNS for app.ordertech.me

  dig +short app.ordertech.me A AAAA

- Desired DNS
  - A record → 34.160.231.88
  - Remove any CNAME to ghs.googlehosted.com

## Load balancer inspection

- List forwarding rules (IP, ports, target):

  gcloud compute forwarding-rules list --global --format="table(name,IPAddress,portRange,target)"

- Describe URL map (host rules and path matchers):

  gcloud compute url-maps describe smartorder-koobs-map --format=json

- List backend services and NEGs:

  gcloud compute backend-services list --global --format="table(name,protocol)"
  gcloud compute network-endpoint-groups list --format="table(name,region,networkEndpointType)"

- SSL certificate status:

  gcloud compute ssl-certificates list --format="table(name,managed.status,managed.domains)"

## Cloud Run

- Describe prod (europe-west1) service URL:

  gcloud run services describe smart-order --region=europe-west1 --format="value(status.url)"

- Describe legacy/test (me-central1) service URL:

  gcloud run services describe smart-order --region=me-central1 --format="value(status.url)"

- Deploy (prod europe-west1):

  gcloud run deploy smart-order --source . \
    --project=smart-order-469705 --region=europe-west1 --allow-unauthenticated

- Deploy (test me-central1):

  gcloud run deploy smart-order --source . \
    --project=smart-order-469705 --region=me-central1 --allow-unauthenticated

## Health and Admin

- Health (prod):
  - https://app.ordertech.me/health
- Admin UI (prod):
  - https://app.ordertech.me/public/admin/

## Backend behavior

- Image proxy /img allowlist:
  - ENV IMG_PROXY_ALLOW_HOSTS (default: foodics.com)
- CSV import (non-DB):
  - POST /admin/tenants/:id/catalog/import
  - Body example: {"source":"csv","categories":true,"products":false,"replace":true}

## Useful console links

- Cloud Run (prod): https://console.cloud.google.com/run/detail/europe-west1/smart-order/metrics?project=smart-order-469705
- HTTPS LB: https://console.cloud.google.com/net-services/loadbalancing/list?project=smart-order-469705
- Certificates: https://console.cloud.google.com/net-services/loadbalancing/advanced/sslCertificates/list?project=smart-order-469705

## Secrets (reference)

- See docs/SECRETS.md for creating/rotating DATABASE_URL in Secret Manager, granting Cloud Run access, and local proxy usage. Never commit or echo secrets.

