#!/usr/bin/env bash
set -euo pipefail

# OrderTech Cloud Sync - Pull data from production to local development
# Syncs database, storage, and configuration from Google Cloud

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"
DEV_DIR="$ROOT_DIR/dev"

echo "☁️  OrderTech Cloud Sync - Download"
echo "===================================="

# Load environment
if [[ -f "$DEV_DIR/.env.local" ]]; then
    set -a
    source "$DEV_DIR/.env.local"
    set +a
else
    echo "❌ Environment file not found: $DEV_DIR/.env.local"
    echo "   Please run ./dev/scripts/dev-start.sh first"
    exit 1
fi

# Check dependencies
MISSING_DEPS=()

if ! command -v gcloud &> /dev/null; then
    MISSING_DEPS+=("gcloud")
fi

if ! command -v gsutil &> /dev/null; then
    MISSING_DEPS+=("gsutil")
fi

if ! command -v pg_dump &> /dev/null; then
    MISSING_DEPS+=("pg_dump")
fi

if ! command -v docker &> /dev/null; then
    MISSING_DEPS+=("docker")
fi

if [[ ${#MISSING_DEPS[@]} -gt 0 ]]; then
    echo "❌ Missing required tools:"
    for dep in "${MISSING_DEPS[@]}"; do
        echo "   - $dep"
    done
    echo ""
    echo "   Please install the Google Cloud SDK and ensure Docker is running"
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
if [[ "$CURRENT_PROJECT" != "${GOOGLE_CLOUD_PROJECT:-smart-order-469705}" ]]; then
    echo "❌ Wrong Google Cloud project"
    echo "   Expected: ${GOOGLE_CLOUD_PROJECT:-smart-order-469705}"
    echo "   Current: $CURRENT_PROJECT"
    echo "   Run: gcloud config set project ${GOOGLE_CLOUD_PROJECT:-smart-order-469705}"
    exit 1
fi

echo "✅ Authenticated as $(gcloud config get-value account) in project $CURRENT_PROJECT"

# Create sync directory
SYNC_DIR="$DEV_DIR/sync-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$SYNC_DIR"
echo "📁 Sync directory: $SYNC_DIR"

# Sync 1: Database (if Cloud SQL Proxy is running)
echo ""
echo "🗄️  Syncing database..."
if lsof -i :6555 &> /dev/null; then
    echo "   Dumping schema and data from Cloud SQL..."
    
    DB_DUMP_FILE="$SYNC_DIR/ordertech-db.sql"
    
    # Try to connect and dump
    if PGPASSWORD="$DB_PASSWORD" pg_dump \
        --host="$DB_HOST" \
        --port="$DB_PORT" \
        --username="$DB_USER" \
        --dbname="$DB_NAME" \
        --no-password \
        --verbose \
        --clean \
        --if-exists \
        --create \
        --format=plain \
        --file="$DB_DUMP_FILE" 2>/dev/null; then
        
        echo "   ✅ Database dumped to: $(basename "$DB_DUMP_FILE")"
        echo "   📊 Size: $(du -h "$DB_DUMP_FILE" | cut -f1)"
        
        # Offer to restore to local database
        if lsof -i :5432 &> /dev/null; then
            echo ""
            read -p "   🤔 Restore to local Postgres (127.0.0.1:5432)? [y/N]: " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                echo "   📥 Restoring to local database..."
                # Create database if it doesn't exist
                createdb -h 127.0.0.1 -p 5432 -U postgres ordertech 2>/dev/null || true
                
                if psql -h 127.0.0.1 -p 5432 -U postgres -d ordertech -f "$DB_DUMP_FILE" >/dev/null 2>&1; then
                    echo "   ✅ Database restored to local Postgres"
                else
                    echo "   ⚠️  Database restore had some issues (check manually)"
                fi
            fi
        fi
    else
        echo "   ❌ Failed to dump database"
        echo "   Check your Cloud SQL Proxy connection and credentials"
    fi
else
    echo "   ⚠️  Cloud SQL Proxy not detected on port 6555"
    echo "   Start it first to sync database data"
fi

# Sync 2: Cloud Storage to local MinIO
echo ""
echo "🗂️  Syncing storage..."

if [[ -n "${CLOUD_STORAGE_BUCKET:-}" ]]; then
    echo "   Downloading from gs://$CLOUD_STORAGE_BUCKET..."
    
    STORAGE_SYNC_DIR="$SYNC_DIR/storage"
    mkdir -p "$STORAGE_SYNC_DIR"
    
    # Download with gsutil (only recent files to avoid huge downloads)
    if gsutil -m rsync -r -d -x ".*\.tmp$" "gs://$CLOUD_STORAGE_BUCKET" "$STORAGE_SYNC_DIR" 2>/dev/null; then
        echo "   ✅ Storage synced to: $(basename "$STORAGE_SYNC_DIR")"
        echo "   📊 Files: $(find "$STORAGE_SYNC_DIR" -type f | wc -l | tr -d ' ')"
        
        # Upload to local MinIO if it's running
        if docker compose ps minio --format json 2>/dev/null | jq -r '.State' | grep -q running; then
            echo "   📤 Uploading to local MinIO..."
            
            # Use mc (MinIO Client) to upload
            if docker run --rm --network ordertech-dev_infra \
                -v "$STORAGE_SYNC_DIR:/sync:ro" \
                -e MINIO_ROOT_USER="${MINIO_ROOT_USER:-ordertech-dev}" \
                -e MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-ordertech-dev-secret}" \
                minio/mc:latest sh -c "
                mc alias set local http://ordertech-minio:9000 \$MINIO_ROOT_USER \$MINIO_ROOT_PASSWORD >/dev/null 2>&1 &&
                mc mirror --overwrite /sync/ local/ordertech-local/
                " >/dev/null 2>&1; then
                echo "   ✅ Files uploaded to local MinIO"
            else
                echo "   ⚠️  Could not upload to MinIO automatically"
                echo "      Files are available in: $STORAGE_SYNC_DIR"
            fi
        else
            echo "   ℹ️  MinIO not running - files saved to: $STORAGE_SYNC_DIR"
        fi
    else
        echo "   ❌ Failed to download from Cloud Storage"
        echo "   Check bucket permissions: gs://$CLOUD_STORAGE_BUCKET"
    fi
else
    echo "   ⚠️  CLOUD_STORAGE_BUCKET not configured"
fi

# Sync 3: Secrets (for reference only - we don't store them)
echo ""
echo "🔐 Listing available secrets..."
if gcloud secrets list --format="table(name)" --filter="name~ordertech" 2>/dev/null | tail -n +2; then
    echo "   ℹ️  Use 'gcloud secrets versions access latest --secret=SECRET_NAME' to retrieve values"
    echo "   ⚠️  Remember to add them to your dev/.env.local file"
else
    echo "   ⚠️  No secrets found or permission denied"
fi

# Summary
echo ""
echo "📋 Sync Summary"
echo "==============="
echo "   Sync directory: $SYNC_DIR"

if [[ -f "$SYNC_DIR/ordertech-db.sql" ]]; then
    echo "   ✅ Database: $(du -h "$SYNC_DIR/ordertech-db.sql" | cut -f1)"
fi

if [[ -d "$SYNC_DIR/storage" ]]; then
    FILE_COUNT=$(find "$SYNC_DIR/storage" -type f | wc -l | tr -d ' ')
    echo "   ✅ Storage: $FILE_COUNT files"
fi

echo ""
echo "🚀 Next steps:"
echo "   1. Review synced data in: $SYNC_DIR"
echo "   2. Update dev/.env.local with any new secrets"
echo "   3. Restart your API to pick up changes"
echo "   4. Clean up sync directory when done: rm -rf $SYNC_DIR"
echo ""
echo "⚠️  Important: This data is for development only"
echo "   Don't commit sensitive data to version control"