# Google AI Deployment Guide for OrderTech

This guide walks you through deploying OrderTech with Google AI (Gemini) integration on Google Cloud Run.

## Why Google AI?

✅ **Better for your environment**: Integrated with Google Cloud ecosystem  
✅ **Cost-effective**: More competitive pricing than OpenAI  
✅ **Better performance**: Gemini 1.5 Flash is optimized for speed  
✅ **Native Google Cloud**: Seamless integration with Cloud Run, Secret Manager  
✅ **No rate limiting headaches**: More generous limits than OpenAI  

## Prerequisites

1. Google Cloud Project with billing enabled
2. `gcloud` CLI installed and authenticated
3. Google AI Studio API key

## Step 1: Get Google AI API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click "Create API Key"
3. Copy the API key (starts with `AIza...`)

## Step 2: Local Testing (Optional)

Test locally before deploying:

```bash
# 1. Set your API key
echo "GOOGLE_AI_API_KEY=your_api_key_here" >> .env.local

# 2. Generate encryption key for tokens
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env.local

# 3. Start the server
npm run dev

# 4. Test the AI endpoints (in another terminal)
node test-ai-endpoints.js
```

Expected output:
```
✅ Server is running
1️⃣ Testing token request...
Status: 200
✅ Token received successfully
...
```

## Step 3: Deploy to Cloud Run

```bash
# Deploy using your existing script
./deploy-cloud-run.sh
```

This will deploy to your existing Cloud Run service in `me-central1`.

## Step 4: Configure Environment Variables

After deployment, configure the AI-specific environment variables:

```bash
# 1. Set Google AI API key
gcloud run services update ordertech \
  --region me-central1 \
  --set-env-vars "GOOGLE_AI_API_KEY=your_api_key_here"

# 2. Set encryption key for AI tokens
gcloud run services update ordertech \
  --region me-central1 \
  --set-env-vars "ENCRYPTION_KEY=$(openssl rand -hex 32)"

# 3. Enable AI features
gcloud run services update ordertech \
  --region me-central1 \
  --set-env-vars "AI_ENABLED=true"
```

## Step 5: Test Deployed Service

Get your service URL:
```bash
SERVICE_URL=$(gcloud run services describe ordertech --region me-central1 --format="value(status.url)")
echo "Service URL: $SERVICE_URL"
```

Test the AI endpoints:
```bash
# Test token request
curl -X POST $SERVICE_URL/ai/token \
  -H "Content-Type: application/json" \
  -H "X-Device-Token: test-token" \
  -d '{
    "device_id": "test-device-123",
    "branch_name": "Test Branch"
  }'
```

Expected response:
```json
{
  "token": "abc123...",
  "expires_at": "2024-01-01T12:05:00.000Z",
  "ttl_seconds": 300
}
```

## Step 6: Update iOS App

Update your iOS OpenAIClient.swift to point to your Cloud Run service:

```swift
private let baseURL = URL(string: "https://your-service-url.run.app")!
```

## Step 7: Database Setup (if needed)

If you need to set up Cloud SQL for AI session logging:

```bash
# Create Cloud SQL instance (if not already exists)
gcloud sql instances create ordertech-db \
  --database-version=POSTGRES_14 \
  --tier=db-f1-micro \
  --region=me-central1

# Create database
gcloud sql databases create ordertech --instance=ordertech-db

# Connect Cloud Run to Cloud SQL
gcloud run services update ordertech \
  --region me-central1 \
  --add-cloudsql-instances "smart-order-469705:me-central1:ordertech-db" \
  --set-env-vars "PGHOST=/cloudsql/smart-order-469705:me-central1:ordertech-db" \
  --set-env-vars "PGUSER=your-db-user" \
  --set-env-vars "PGDATABASE=ordertech" \
  --set-env-vars "PGPASSWORD=your-db-password"
```

## API Endpoints

The following AI endpoints are now available:

### 1. Request AI Token
```
POST /ai/token
Headers: X-Device-Token: <device_token>
Body: {"device_id": "uuid", "branch_name": "string"}
```

### 2. Start AI Session
```
POST /ai/sessions
Headers: Authorization: Bearer <ai_token>
Body: {"settings": {"model": "gemini-1.5-flash"}}
```

### 3. Stream Chat
```
POST /ai/chat/stream
Headers: Authorization: Bearer <ai_token>
Body: {
  "session_id": "uuid",
  "messages": [{"role": "user", "content": "Hello"}]
}
```

### 4. Log Events
```
POST /ai/events
Headers: Authorization: Bearer <ai_token>
Body: {
  "session_id": "uuid", 
  "events": [{"type": "speech_start", "timestamp": "ISO8601"}]
}
```

### 5. End Session
```
POST /ai/sessions/:sessionId/end
Headers: Authorization: Bearer <ai_token>
```

## Security Features

✅ **Ephemeral Tokens**: 5-minute expiry, auto-cleanup  
✅ **Rate Limiting**: 30 requests/minute per device  
✅ **Device Scoping**: Tokens tied to specific devices  
✅ **Tenant Isolation**: All data scoped to tenant boundaries  
✅ **Encrypted Storage**: Token encryption with AES-256-GCM  

## Monitoring

Monitor your AI service usage:

```bash
# View logs
gcloud logs read --project=smart-order-469705 --resource-type=cloud_run_revision --filter="AI"

# Monitor metrics
gcloud monitoring metrics list --filter="resource.type=cloud_run_revision"
```

## Cost Optimization

- **Gemini 1.5 Flash**: ~$0.35 per 1M tokens (much cheaper than GPT-4)
- **Cloud Run**: Pay per request, scales to zero
- **Token Caching**: 5-minute token reuse reduces API calls
- **Rate Limiting**: Prevents abuse and unexpected costs

## Troubleshooting

### "ai_unavailable" Error
- Check `GOOGLE_AI_API_KEY` is set correctly
- Verify API key has correct permissions
- Check Google AI Studio quota limits

### "invalid_token" Error
- Token expired (5-minute TTL)
- Request a new token from `/ai/token`

### "rate_limit_exceeded" Error
- Wait 1 minute and retry
- Check if you're making too many requests

### iOS Connection Issues
- Verify Cloud Run service URL is correct
- Check iOS simulator network connectivity
- Test endpoints with curl first

## Next Steps

1. **Set up monitoring**: Configure alerts for errors and usage
2. **Add custom domain**: Set up SSL certificate for production
3. **Implement caching**: Add Redis for token storage at scale
4. **Add more AI models**: Support for different Gemini models
5. **Customer recognition**: Integrate with loyalty systems

## Support

- Google AI Documentation: https://ai.google.dev/docs
- Cloud Run Documentation: https://cloud.google.com/run/docs
- OrderTech AI Integration: See `AI_INTEGRATION.md`

---

🎉 **Your OrderTech AI backend is now ready for production!**

Test it with the iOS DisplayApp and start taking voice orders powered by Google AI.