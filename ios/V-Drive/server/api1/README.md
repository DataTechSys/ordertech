# App API (api1.ordertech.me)

This is a minimal read-optimized API for devices. It proxies to the Admin origin and adds caching/ETag to reduce load.

Endpoints
- GET /healthz
- GET /brand
- GET /device/profile
- GET /categories
- GET /products
- GET /manifest  // brand + device profile bundled

Headers forwarded
- x-tenant-id
- x-device-token
- if-none-match (for conditional requests)

Caching
- brand/categories/products: Cache-Control public, max-age=300
- device/profile and manifest: Cache-Control public, max-age=60
- ETag/Last-Modified are forwarded from Admin to clients.

Local development
1) cd server/api1
2) ADMIN_BASE=https://app.ordertech.me npm i
3) ADMIN_BASE=https://app.ordertech.me npm run dev
4) In the iOS app Settings, set Environment to Custom with base http://localhost:8080

Production
- Deploy server/api1 as a service (Node 18+) behind HTTPS and DNS api1.ordertech.me.
- Set ADMIN_BASE env to your Admin origin.
- Optionally place a CDN in front for better caching.
