#!/bin/bash
set -e

PROJECT_ID="smart-order-469705"
REGION="me-central1"
JOB_NAME="foodics-backfill-2025"

echo "🚀 Deploying 2025 Backfill Job to Cloud Run..."

# Build container
echo "📦 Building container..."
gcloud builds submit --tag gcr.io/$PROJECT_ID/foodics-backfill:latest --dockerfile jobs/Dockerfile.backfill-2025 .

# Deploy job with Cloud SQL
echo "🚀 Deploying job..."
gcloud run jobs deploy $JOB_NAME \
  --image gcr.io/$PROJECT_ID/foodics-backfill:latest \
  --region $REGION \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest" \
  --set-cloudsql-instances "$PROJECT_ID:$REGION:ordertech-db" \
  --memory "512Mi" \
  --cpu "1" \
  --max-retries 0 \
  --task-timeout "3600s"

echo ""
echo "✅ Job deployed successfully!"
echo ""
echo "To run manually:"
echo "  gcloud run jobs execute $JOB_NAME --region $REGION"
echo ""
echo "To schedule (run every hour):"
echo "  gcloud scheduler jobs create http foodics-backfill-hourly \\"
echo "    --location europe-west1 \\"
echo "    --schedule='0 * * * *' \\"
echo "    --uri='https://$REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT_ID/jobs/$JOB_NAME:run' \\"
echo "    --http-method POST \\"
echo "    --oauth-service-account-email 715493130630-compute@developer.gserviceaccount.com"
