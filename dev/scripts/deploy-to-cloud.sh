#!/usr/bin/env bash
set -euo pipefail

# OrderTech Cloud Deploy - Deploy local changes to Cloud Run
# Uses the existing deploy-cloud-run.sh with preflight checks

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"
DEV_DIR="$ROOT_DIR/dev"

echo "🚀 OrderTech Cloud Deploy"
echo "=========================="

# Load environment
if [[ -f "$DEV_DIR/.env.local" ]]; then
    set -a
    source "$DEV_DIR/.env.local"
    set +a
fi

# Check if we're in the right directory and have the deployment script
if [[ ! -f "$ROOT_DIR/deploy-cloud-run.sh" ]]; then
    echo "❌ Deployment script not found: $ROOT_DIR/deploy-cloud-run.sh"
    echo "   Make sure you're running this from the OrderTech repo root"
    exit 1
fi

# Check authentication
echo "🔐 Checking Google Cloud authentication..."
if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
    echo "❌ Not authenticated with Google Cloud"
    echo "   Run: gcloud auth application-default login"
    exit 1
fi

# Check project
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
EXPECTED_PROJECT="${GOOGLE_CLOUD_PROJECT:-smart-order-469705}"

if [[ "$CURRENT_PROJECT" != "$EXPECTED_PROJECT" ]]; then
    echo "❌ Wrong Google Cloud project"
    echo "   Expected: $EXPECTED_PROJECT"
    echo "   Current: $CURRENT_PROJECT"
    echo "   Run: gcloud config set project $EXPECTED_PROJECT"
    exit 1
fi

# Check region
CURRENT_REGION=$(gcloud config get-value run/region 2>/dev/null || echo "")
EXPECTED_REGION="${GCLOUD_REGION:-me-central1}"

if [[ "$CURRENT_REGION" != "$EXPECTED_REGION" ]]; then
    echo "🔧 Setting Cloud Run region to $EXPECTED_REGION..."
    gcloud config set run/region "$EXPECTED_REGION"
fi

echo "✅ Authenticated as $(gcloud config get-value account)"
echo "   Project: $CURRENT_PROJECT"
echo "   Region: $EXPECTED_REGION"

# Show current Cloud Run service status
echo ""
echo "☁️  Current Cloud Run service status:"
if gcloud run services describe ordertech --region="$EXPECTED_REGION" --format="table(status.url,status.conditions.status,spec.template.spec.containers.image)" 2>/dev/null; then
    echo ""
else
    echo "   ⚠️  Service 'ordertech' not found or not accessible"
fi

# Pre-deployment checks
echo "🔍 Pre-deployment checks..."

# Check if there are uncommitted changes
if git status --porcelain | grep -q .; then
    echo "⚠️  You have uncommitted changes:"
    git status --porcelain | head -10
    echo ""
    read -p "   Continue with deployment? [y/N]: " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "   Deployment cancelled"
        exit 1
    fi
fi

# Show what will be deployed
CURRENT_BRANCH=$(git branch --show-current)
CURRENT_COMMIT=$(git rev-parse --short HEAD)
echo "   Branch: $CURRENT_BRANCH"
echo "   Commit: $CURRENT_COMMIT ($(git log -1 --format=%s))"

# Confirm deployment
echo ""
echo "🎯 Ready to deploy to Cloud Run:"
echo "   Service: ordertech"
echo "   Region: $EXPECTED_REGION"
echo "   URL: ${CLOUD_RUN_URL:-https://ordertech-715493130630.me-central1.run.app}"
echo ""
read -p "Proceed with deployment? [y/N]: " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled"
    exit 0
fi

# Run the deployment
echo ""
echo "🚀 Starting deployment..."
echo "========================"

cd "$ROOT_DIR"

# Use the existing deployment script
if bash deploy-cloud-run.sh; then
    echo ""
    echo "✅ Deployment completed successfully!"
    echo ""
    
    # Test the deployed service
    echo "🧪 Testing deployed service..."
    if curl -sf "${CLOUD_RUN_URL:-https://ordertech-715493130630.me-central1.run.app}/health" >/dev/null 2>&1; then
        echo "✅ Service is responding"
    else
        echo "⚠️  Service may not be responding yet (check logs)"
    fi
    
    # Show post-deployment info
    echo ""
    echo "📊 Post-deployment information:"
    echo "   Service URL: ${CLOUD_RUN_URL:-https://ordertech-715493130630.me-central1.run.app}"
    echo "   View logs: gcloud run services logs read ordertech --region=$EXPECTED_REGION"
    echo "   Service info: gcloud run services describe ordertech --region=$EXPECTED_REGION"
    echo ""
    echo "🔗 Useful links:"
    echo "   Cloud Console: https://console.cloud.google.com/run/detail/$EXPECTED_REGION/ordertech/metrics?project=$CURRENT_PROJECT"
    echo "   Logs: https://console.cloud.google.com/logs/query?project=$CURRENT_PROJECT"
    
else
    echo ""
    echo "❌ Deployment failed"
    echo "   Check the error messages above"
    echo "   View logs: gcloud run services logs read ordertech --region=$EXPECTED_REGION"
    exit 1
fi

# Compare local and deployed versions
echo ""
echo "🔍 Local vs Cloud comparison:"
echo "   Local API:  https://api.localhost"
echo "   Cloud API:  ${CLOUD_RUN_URL:-https://ordertech-715493130630.me-central1.run.app}"
echo ""
echo "   Test both endpoints:"
echo "   curl https://api.localhost/health"
echo "   curl ${CLOUD_RUN_URL:-https://ordertech-715493130630.me-central1.run.app}/health"