#!/bin/bash

# Monitor the automated Foodics sales import Cloud Scheduler job

PROJECT_ID="smart-order-469705"
REGION="us-central1"
JOB_NAME="foodics-sales-import"

echo "📊 Monitoring Foodics Sales Import Automation"
echo "============================================="
echo ""

# Check job status
echo "🔍 Cloud Scheduler Job Status:"
gcloud scheduler jobs describe $JOB_NAME \
    --location=$REGION \
    --project=$PROJECT_ID \
    --format="table(name.basename(),schedule,state,lastAttemptTime,nextRunTime)"

echo ""

# Show recent job execution logs
echo "📝 Recent Job Execution Logs (last 10):"
gcloud logging read \
    "resource.type=cloud_scheduler_job AND resource.labels.job_id=$JOB_NAME" \
    --limit=10 \
    --project=$PROJECT_ID \
    --format="table(timestamp,severity,textPayload.slice(0:100))"

echo ""

# Show recent Cloud Run logs related to sales import
echo "🏃 Recent Cloud Run Import Logs (last 10):"
gcloud logging read \
    "resource.type=cloud_run_revision AND resource.labels.service_name=ordertech AND (textPayload:\"Foodics sales\" OR textPayload:\"auto import\" OR textPayload:\"import-sales\")" \
    --limit=10 \
    --project=$PROJECT_ID \
    --format="table(timestamp,severity,textPayload.slice(0:120))"

echo ""

# Quick statistics
echo "📈 Quick Stats:"
echo "   Job Schedule: Every 5 minutes (*/5 * * * *)"
echo "   Next Run: $(gcloud scheduler jobs describe $JOB_NAME --location=$REGION --project=$PROJECT_ID --format='value(nextRunTime)')"
echo "   Last Attempt: $(gcloud scheduler jobs describe $JOB_NAME --location=$REGION --project=$PROJECT_ID --format='value(lastAttemptTime)')"

echo ""
echo "🔧 Management Commands:"
echo "   Pause job:   gcloud scheduler jobs pause $JOB_NAME --location=$REGION --project=$PROJECT_ID"
echo "   Resume job:  gcloud scheduler jobs resume $JOB_NAME --location=$REGION --project=$PROJECT_ID"
echo "   Run now:     gcloud scheduler jobs run $JOB_NAME --location=$REGION --project=$PROJECT_ID"
echo "   Delete job:  gcloud scheduler jobs delete $JOB_NAME --location=$REGION --project=$PROJECT_ID"