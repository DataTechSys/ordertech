#!/bin/bash

# Deploy Cloud Scheduler job for automated Foodics sales import every 5 minutes

set -e

PROJECT_ID="smart-order-469705"
REGION="us-central1"
JOB_NAME="foodics-sales-import"
SERVICE_URL="https://ordertech-715493130630.me-central1.run.app/admin/integrations/foodics/auto-import-sales"

# Set default admin token if not provided
if [ -z "$ADMIN_TOKEN" ]; then
    ADMIN_TOKEN="test-admin-token"
    echo "⚠️  Using default admin token for development"
fi

echo "🔧 Setting up Cloud Scheduler job for Foodics sales import..."
echo "📋 Project: $PROJECT_ID"
echo "🌍 Region: $REGION"
echo "🔗 Service URL: $SERVICE_URL"
echo "⏱️  Schedule: Every 5 minutes"

# Check if job exists
if gcloud scheduler jobs describe $JOB_NAME --location=$REGION --project=$PROJECT_ID >/dev/null 2>&1; then
    echo "🔄 Updating existing Cloud Scheduler job..."
    gcloud scheduler jobs update http $JOB_NAME \
        --location=$REGION \
        --project=$PROJECT_ID \
        --schedule="*/5 * * * *" \
        --uri="$SERVICE_URL" \
        --http-method=POST \
        --headers="Content-Type=application/json,x-admin-token=$ADMIN_TOKEN" \
        --message-body="{}" \
        --attempt-deadline=300s \
        --max-retry-attempts=3 \
        --max-retry-duration=60s \
        --min-backoff=5s \
        --max-backoff=60s \
        --time-zone=UTC
else
    echo "🆕 Creating new Cloud Scheduler job..."
    gcloud scheduler jobs create http $JOB_NAME \
        --location=$REGION \
        --project=$PROJECT_ID \
        --schedule="*/5 * * * *" \
        --uri="$SERVICE_URL" \
        --http-method=POST \
        --headers="Content-Type=application/json,x-admin-token=$ADMIN_TOKEN" \
        --message-body="{}" \
        --attempt-deadline=300s \
        --max-retry-attempts=3 \
        --max-retry-duration=60s \
        --min-backoff=5s \
        --max-backoff=60s \
        --time-zone=UTC \
        --description="Automatically import Foodics sales data for all tenants every 5 minutes"
fi

echo "✅ Cloud Scheduler job configured successfully!"
echo ""
echo "📊 Job Status:"
gcloud scheduler jobs describe $JOB_NAME --location=$REGION --project=$PROJECT_ID --format="value(name,schedule,state)"

echo ""
echo "🧪 Testing the job (manual trigger):"
gcloud scheduler jobs run $JOB_NAME --location=$REGION --project=$PROJECT_ID

echo ""
echo "🎉 Automated Foodics sales import is now running every 5 minutes!"
echo "📝 Monitor logs: gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=ordertech' --limit=50"
echo "📋 View job: https://console.cloud.google.com/cloudscheduler?project=$PROJECT_ID"