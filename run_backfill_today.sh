#!/bin/bash
set -e

PROJECT_ID="smart-order-469705"
REGION="me-central1"
JOB_NAME="backfill-today-branches"

echo "🚀 Deploying and running backfill job..."

# Build with Cloud Build
echo "📦 Building image with Cloud Build..."
gcloud builds submit --config=jobs/cloudbuild-backfill.yaml .

# Deploy job
echo "🚀 Deploying job..."
gcloud run jobs deploy $JOB_NAME \
  --image gcr.io/$PROJECT_ID/$JOB_NAME:latest \
  --region $REGION \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest" \
  --set-cloudsql-instances "$PROJECT_ID:$REGION:ordertech-db" \
  --memory "512Mi" \
  --cpu "1" \
  --max-retries 0 \
  --task-timeout "15m"

# Run it
echo ""
echo "▶️  Executing job..."
gcloud run jobs execute $JOB_NAME --region $REGION

echo ""
echo "✅ Job started! View logs:"
echo "  gcloud run jobs logs tail $JOB_NAME --region $REGION"
