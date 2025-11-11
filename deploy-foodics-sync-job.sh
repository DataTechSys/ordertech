#!/bin/bash
set -e

PROJECT_ID="smart-order-469705"
JOB_NAME="foodics-sync"
REGION="me-central1"

echo "🚀 Deploying Foodics Sync Job to Cloud Run"
echo "==========================================="

# Build container image
echo "📦 Building container image..."
gcloud builds submit --config=jobs/cloudbuild.yaml .

# Deploy the job
echo "🚀 Deploying job..."
gcloud run jobs deploy $JOB_NAME \
  --image gcr.io/$PROJECT_ID/$JOB_NAME:latest \
  --region $REGION \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest" \
  --set-cloudsql-instances "$PROJECT_ID:$REGION:ordertech-db" \
  --memory "512Mi" \
  --cpu "1" \
  --max-retries 2 \
  --task-timeout "10m"

echo ""
echo "✅ Job deployed: $JOB_NAME"
echo ""
echo "To run manually:"
echo "  gcloud run jobs execute $JOB_NAME --region $REGION"
echo ""
echo "To view logs:"
echo "  gcloud run jobs executions list --region $REGION --job $JOB_NAME"
echo "  gcloud run jobs logs tail $JOB_NAME --region $REGION"
