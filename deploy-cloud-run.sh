#!/bin/bash
# Deploy OrderTech to Cloud Run with database configuration
#
# ⚠️ WARNING: THIS SCRIPT DEPLOYS TO me-central1 ONLY!
# DO NOT MODIFY THE REGION - ALL INFRASTRUCTURE IS IN me-central1
#

set -e

PROJECT_ID="smart-order-469705"
# Use existing service name - DO NOT CREATE NEW SERVICES
SERVICE_NAME="ordertech"
# IMPORTANT: ALWAYS USE me-central1 - DO NOT CREATE SERVICES IN OTHER REGIONS
REGION="me-central1"

echo "🚀 Deploying OrderTech to Cloud Run"
echo "===================================="

# Validate region is correct
if [ "$REGION" != "me-central1" ]; then
    echo "❌ ERROR: Wrong region configured!"
    echo "   Expected: me-central1"
    echo "   Got: $REGION"
    echo "   See REGION_CONFIG.md for details"
    exit 1
fi

echo "✅ Region validated: $REGION"

# Deploy the service
echo "📦 Building and deploying container..."
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,LIVEKIT_API_KEY=livekit-api-key:latest,LIVEKIT_API_SECRET=livekit-api-secret:latest,OPENAI_API_KEY=openai-api-key:latest,OPENAI_ASSISTANT_ID=openai-assistant-id:latest,LIVEKIT_WS_URL=livekit-ws-url:latest,FOODICS_TOKEN=FOODICS_TOKEN:latest" \
  --memory "512Mi" \
  --cpu "1" \
  --timeout "300s" \
  --max-instances "10"

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format="value(status.url)")
echo "✅ Service deployed: $SERVICE_URL"

echo ""
echo "⚠️  IMPORTANT: Configuration needed for AI features!"
echo "To enable Google AI integration:"
echo ""
echo "# Set Google AI API key:"
echo "gcloud run services update ordertech \\"
echo "  --region $REGION \\"
echo "  --set-env-vars \"GOOGLE_AI_API_KEY=your-google-ai-api-key\""
echo ""
echo "# Set encryption key for AI tokens (generate with: openssl rand -hex 32):"
echo "gcloud run services update ordertech \\"
echo "  --region $REGION \\"
echo "  --set-env-vars \"ENCRYPTION_KEY=your-32-byte-hex-key\""
echo ""
echo "⚠️  Database configuration needed!"
echo "To connect to Cloud SQL, run:"
echo ""
echo "# For Cloud SQL connection:"
echo "gcloud run services update ordertech \\\\"
echo "  --region $REGION \\"
echo "  --add-cloudsql-instances \"$PROJECT_ID:me-central1:your-instance-name\" \\"
echo "  --set-env-vars \"PGHOST=/cloudsql/$PROJECT_ID:me-central1:your-instance-name\" \\"
echo "  --set-env-vars \"PGUSER=your-db-user\" \\"
echo "  --set-env-vars \"PGDATABASE=your-db-name\" \\"
echo "  --set-env-vars \"PGPASSWORD=your-db-password\""
echo ""
echo "# OR for external database:"
echo "gcloud run services update ordertech \\\\"
echo "  --region $REGION \\"
echo "  --set-env-vars \"DATABASE_URL=postgresql://user:pass@host:port/db\""
echo ""
echo "🎯 Once configured, test with:"
echo "curl -X POST $SERVICE_URL/admin/sync-modifiers/final"