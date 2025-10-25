# RTC setup (LiveKit → P2P → Twilio)

This app is wired for 3-path RTC with automatic fallback:
- **Self-hosted LiveKit** first (primary SFU)
- P2P second (direct connection fallback)
- Twilio Video as last resort

## Self-hosted LiveKit (Primary)
- **Domain**: `rtc.ordertech.me` (points to `34.18.149.201`)
- **VM**: `livekit-1` in me-central1-a (e2-standard-4)
- **Architecture**: Docker containers with Caddy reverse proxy
- **Security**: Secrets stored in Google Secret Manager
- **Ports**: 443 (TLS/WSS), 50000-60000 (UDP media)
- **Fallback order**: Set by RTC_FALLBACK_ORDER (current: `livekit`)
- **Documentation**: See `docs/setup-livekit-selfhost.md`

Secret Management:
- All secrets loaded from GCP Secret Manager (no secrets in env)
- Set GCP_SECRETS_ENABLE=1 and ensure ADC is configured
- Secrets: `livekit-api-key`, `livekit-api-secret`, `livekit-ws-url`

Twilio
- Used for:
  - Ephemeral ICE servers to improve P2P connectivity.
  - Final fallback provider if SFU is needed and LiveKit is unavailable.
- Credentials are not stored in the repo.

Secret strategy (do this once and avoid re-entering keys)
- Production and staging should load Twilio credentials from Google Secret Manager.
- The server reads env directly OR, if missing, fetches from GSM using the following envs:
  - GCP_SECRETS_ENABLE=1
  - GCP_PROJECT_ID=your-project-id (not needed if full resource paths are used below and ADC is configured)
  - TWILIO_ACCOUNT_SID_SECRET=twilio-account-sid (or full resource path)
  - TWILIO_KEY_SID_SECRET=twilio-key-sid (or full resource path)
  - TWILIO_KEY_SECRET_SECRET=twilio-key-secret (or full resource path)
- ADC: run the app on GCP (or provide GOOGLE_APPLICATION_CREDENTIALS) with secretmanager.versions.access permission.

Validation
- GET /webrtc/config → should show:
  - sfu.enabled: true
  - sfu.livekit.url: wss://rtc.ordertech.me
  - sfu.fallbackOrder: ["p2p","livekit","twilio"]
- POST /rtc/token { provider:"livekit", basketId, role } → returns { token, url:wss://rtc.ordertech.me }
- POST /rtc/token { provider:"twilio", basketId, role } → returns a Twilio Video token when GSM/env creds are present.

Operational notes
- Keep your app served over HTTPS and allow WebSocket upgrades.
- For P2P reliability without Twilio, you may set ICE_SERVERS_JSON or TURN_URLS/USERNAME/PASSWORD to your own TURN.
- Never commit secrets to git. Use PM2 env (host-only), Docker env files (host-only), or your PaaS secret manager.

