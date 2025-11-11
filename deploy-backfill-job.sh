#!/bin/bash
# Deploy and run the 2025 backfill job on Cloud Run

set -e

echo "🚀 Deploying Foodics 2025 Backfill Job..."

# Build and push the container
echo "📦 Building container..."
gcloud builds submit --tag gcr.io/smart-order-469705/ordertech:latest

# Create or update the Cloud Run Job
echo "⚙️  Creating Cloud Run Job..."
gcloud run jobs create foodics-backfill-2025 \
  --image gcr.io/smart-order-469705/ordertech:latest \
  --region me-central1 \
  --set-env-vars DATABASE_URL="postgresql://postgres:OL5eoBqUAF9xTgPm@10.87.32.3:5432/ordertech" \
  --set-env-vars NODE_ENV="production" \
  --command node \
  --args jobs/foodics-backfill-2025.js \
  --task-timeout 3600 \
  --max-retries 0 \
  --memory 512Mi \
  --cpu 1 \
  --vpc-connector projects/smart-order-469705/locations/me-central1/connectors/ordertech-vpc \
  || gcloud run jobs update foodics-backfill-2025 \
  --image gcr.io/smart-order-469705/ordertech:latest \
  --region me-central1 \
  --set-env-vars DATABASE_URL="postgresql://postgres:OL5eoBqUAF9xTgPm@10.87.32.3:5432/ordertech" \
  --set-env-vars NODE_ENV="production" \
  --command node \
  --args jobs/foodics-backfill-2025.js \
  --task-timeout 3600 \
  --max-retries 0 \
  --memory 512Mi \
  --cpu 1 \
  --vpc-connector projects/smart-order-469705/locations/me-central1/connectors/ordertech-vpc

echo ""
echo "✅ Job deployed successfully!"
echo ""
echo "To run the job manually:"
echo "  gcloud run jobs execute foodics-backfill-2025 --region me-central1"
echo ""
echo "To view logs:"
echo "  gcloud logging read 'resource.type=cloud_run_job AND resource.labels.job_name=foodics-backfill-2025' --limit 50 --format json"
echo ""
read -p "🤔 Do you want to execute the job now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "🏃 Executing job..."
  gcloud run jobs execute foodics-backfill-2025 --region me-central1 --wait
  echo "✅ Job execution started! Check logs for progress."
else
  echo "👍 Job deployed but not executed. Run manually when ready."
fi
