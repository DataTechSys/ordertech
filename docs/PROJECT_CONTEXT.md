# Smart Order Project Context

Last updated: 2025-08-29T08:20:14Z

This document captures the current deployment, load balancer routing, domains/DNS, and key backend behavior so the project state survives terminal/agent restarts.

## Services & environments

- Cloud Run (prod)
  - Service: smart-order
  - Region: europe-west1
  - URL: https://smart-order-715493130630.europe-west1.run.app
- Cloud Run (legacy/test)
  - Service: smart-order
  - Region: me-central1 (Cloud Run custom domain mapping not supported in this region)
  - URL: https://smart-order-715493130630.me-central1.run.app

## HTTPS Load Balancer

- Project: smart-order-469705
- Forwarding rules (global):
  - HTTP 80 and HTTPS 443
  - Public IP: 34.160.231.88
- Target HTTPS proxy: smartorder-koobs-https-proxy
- URL map: smartorder-koobs-map
- Host rules:
  - app.ordertech.me → path matcher: app-ordertech
    - default service: backend smartorder-ew1-backend
    - backend smartorder-ew1-backend → serverless NEG smartorder-ew1-neg → Cloud Run service smart-order (europe-west1)
  - smartorder.koobs.cafe → path matcher: smartorder
    - default service: backend bucket smartorder-static-bucket
    - path rules (to backend smartorder-koobs-backend):
      - /assets/*, /branches, /branches/*, /cashier, /cashier/*, /cashier/sessions, /cashier/sessions/*,
        /categories, /categories/*, /drive-thru/state, /drive-thru/state/*, /images/*, /images/resolve,
        /images/resolve/*, /orders, /orders/*, /photos/*, /products, /products/*, /rt/*, /tenants, /tenants/*
    - backend smartorder-koobs-backend → serverless NEG smartorder-koobs-neg (Cloud Run service smart-order-api in me-central1)

## Managed SSL certificates

- app-ordertech-cert (managed):
  - Domains: app.ordertech.me
  - Status: PROVISIONING (will become ACTIVE after DNS points to the LB and validation completes)
- Existing certs on the proxy:
  - smartorder-koobs-cert (smartorder.koobs.cafe): ACTIVE
  - smartorder-dts-cert (smartorder.datatech.systems): ACTIVE

## Domains & DNS

- app.ordertech.me
  - Desired: A record → 34.160.231.88
  - Currently: CNAME to ghs.googlehosted.com (needs updating to use the load balancer IP)

Once DNS updates propagate and the cert is ACTIVE, use:
- https://app.ordertech.me/health
- https://app.ordertech.me/public/admin/
- https://app.ordertech.me/drive
- https://app.ordertech.me/cashier

## Backend features and constraints

- Image proxy /img
  - Default allowlist: foodics.com (and subdomains)
  - Override via env IMG_PROXY_ALLOW_HOSTS (comma-separated domains; strict host or subdomain match)
  - Blocks private/localhost hosts; enforces image content-type; size/time limits; ETag caching
- CSV import endpoint (non-DB mode)
  - POST /admin/tenants/:id/catalog/import { source:"csv", categories:true, products:false, replace:true }
  - Reads data/categories.csv (and products.csv if present) in Foodics format
  - Admin UI button "Import CSV Categories" triggers this import
- Health endpoints
  - /health, /__health, /readyz
- Admin auth
  - Firebase; config served at /public/admin/config.js (via env FIREBASE_API_KEY and FIREBASE_AUTH_DOMAIN or static file)
- Assets upload
  - /admin/upload-url uses ASSETS_BUCKET (GCS) for signed uploads

## Environment variables (selected)

- FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN
- ADMIN_TOKEN (alternative platform admin)
- ASSETS_BUCKET (GCS bucket for uploads)
- IMG_PROXY_ALLOW_HOSTS (default: foodics.com)
- ICE_SERVERS_JSON, TURN_URLS, TURN_USERNAME, TURN_PASSWORD (WebRTC)
- TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN or TWILIO_KEY_SID, TWILIO_KEY_SECRET (optional ICE)
- DEFAULT_TENANT_ID

## Data sources

- CSV files (Foodics exports):
  - data/categories.csv
  - data/products.csv

## Quick links

- Cloud Run (prod): https://console.cloud.google.com/run/detail/europe-west1/smart-order/metrics?project=smart-order-469705
- HTTPS LB: https://console.cloud.google.com/net-services/loadbalancing/list?project=smart-order-469705
- Certificates: https://console.cloud.google.com/net-services/loadbalancing/advanced/sslCertificates/list?project=smart-order-469705

