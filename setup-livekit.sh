#!/bin/bash
set -euo pipefail

# Self-hosted LiveKit Configuration for Google Cloud Run
echo "🚀 Setting up Self-hosted LiveKit for OrderTech..."

# Self-hosted LiveKit configuration
LIVEKIT_WS_URL="wss://rtc.ordertech.me"
# Note: API keys should be generated securely and already exist in Secret Manager

# Your project info (update if needed)
PROJECT_ID="smart-order-469705"
REGION="me-central1"
SERVICE="ordertech"

echo "📋 Project: $PROJECT_ID"
echo "📍 Region: $REGION"
echo "🔧 Service: $SERVICE"
echo "🏠 Self-hosted LiveKit: $LIVEKIT_WS_URL"
echo ""

# Check if secrets exist
echo "1️⃣ Checking LiveKit secrets in Google Secret Manager..."
echo "  ℹ️ LiveKit API keys should already exist from VM setup"
if gcloud secrets describe livekit-api-key --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "  ✅ livekit-api-key exists"
else
    echo "  ❌ livekit-api-key missing - please run VM setup first"
    exit 1
fi

if gcloud secrets describe livekit-api-secret --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "  ✅ livekit-api-secret exists"
else
    echo "  ❌ livekit-api-secret missing - please run VM setup first"
    exit 1
fi

# Update the WebSocket URL secret
echo "  Updating livekit-ws-url secret..."
echo -n "$LIVEKIT_WS_URL" | gcloud secrets create livekit-ws-url --data-file=- --project="$PROJECT_ID" 2>/dev/null || \
echo -n "$LIVEKIT_WS_URL" | gcloud secrets versions add livekit-ws-url --data-file=- --project="$PROJECT_ID"

echo "✅ Secrets verified successfully!"
echo ""

# Step 2: Update the Cloud Run service with self-hosted LiveKit configuration
echo "2️⃣ Updating Cloud Run service with self-hosted LiveKit configuration..."

gcloud run services update "$SERVICE" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --update-secrets="LIVEKIT_API_KEY=livekit-api-key:latest,LIVEKIT_API_SECRET=livekit-api-secret:latest,LIVEKIT_WS_URL=livekit-ws-url:latest" \
    --set-env-vars="RTC_FALLBACK_ORDER=livekit,GCP_SECRETS_ENABLE=1"

echo "✅ Cloud Run service updated successfully!"
echo ""

# Step 3: Test the configuration
echo "3️⃣ Testing configuration..."
sleep 10  # Wait for deployment

echo "  Testing WebRTC config endpoint..."
curl -s "https://app.ordertech.me/webrtc/config" | jq '.sfu'

echo ""
echo "  Testing RTC status endpoint..."
curl -s "https://app.ordertech.me/admin/rtc/status" | jq '.providers'

echo ""
echo "  Testing LiveKit token generation..."
curl -s -X POST "https://app.ordertech.me/rtc/token" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"livekit","basketId":"test-room-1","role":"cashier"}' | jq

echo ""
echo "🎉 Self-hosted LiveKit setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Test video calling between your iOS apps"
echo "2. Check logs: gcloud run logs tail $SERVICE --region=$REGION"
echo "3. Monitor LiveKit server: gcloud compute ssh livekit-1 --zone=me-central1-a --command='docker logs -f livekit-livekit-1'"
echo "4. If you need to rebuild: gcloud builds submit --config cloudbuild.yaml"
echo ""
echo "📡 LiveKit Server Status:"
echo "   VM: livekit-1 (me-central1-a)"
echo "   IP: 34.18.149.201"
echo "   Domain: rtc.ordertech.me"
echo "   Ports: 443 (TLS/WSS), 50000-60000 (UDP media)"
