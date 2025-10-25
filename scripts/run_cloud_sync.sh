#!/bin/bash

# Script to run modifier sync on Google Cloud Run environment
set -e

PROJECT_ID="smart-order-469705"
REGION="me-central1"
SERVICE_NAME="ordertech"
CLOUD_SQL_INSTANCE="smart-order-469705:me-central1:ordertech-db"

echo "🚀 Running modifier sync on Cloud Run service..."

# Create a temporary Cloud Run job that runs the sync script
gcloud run jobs create modifier-sync-job \
    --image gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest \
    --region=${REGION} \
    --project=${PROJECT_ID} \
    --set-env-vars="NODE_ENV=production" \
    --set-cloudsql-instances="${CLOUD_SQL_INSTANCE}" \
    --command="node" \
    --args="scripts/sync_modifiers_from_csv.js" \
    --memory=1Gi \
    --cpu=1 \
    --task-timeout=900 \
    --max-retries=2 \
    --parallelism=1 \
    --task-count=1 \
    --replace || echo "Job might already exist, continuing..."

echo "🔄 Executing the sync job..."

# Execute the job
gcloud run jobs execute modifier-sync-job \
    --region=${REGION} \
    --project=${PROJECT_ID} \
    --wait

echo "📊 Checking job logs..."

# Get the latest execution logs
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"modifier-sync-job\"" \
    --limit=50 \
    --format="value(textPayload)" \
    --project=${PROJECT_ID}

echo "✅ Modifier sync job completed!"