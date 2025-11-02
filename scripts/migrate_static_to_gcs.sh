#!/bin/bash
# Migrate static assets to GCS bucket ordertech.me
# This script uploads images, fonts, and root-level static files to GCS
# with proper caching headers for production use.

set -euo pipefail

BUCKET="ordertech.me"
CACHE_CONTROL="public, max-age=31536000, immutable"

echo "=== Static Assets Migration to GCS ==="
echo "Bucket: gs://${BUCKET}"
echo ""

# Check if gcloud is available
if ! command -v gsutil &> /dev/null; then
    echo "ERROR: gsutil not found. Please install Google Cloud SDK."
    exit 1
fi

# Verify bucket exists
echo "Checking bucket access..."
if ! gsutil ls "gs://${BUCKET}" > /dev/null 2>&1; then
    echo "ERROR: Cannot access bucket gs://${BUCKET}"
    echo "Please ensure you have proper permissions."
    exit 1
fi

echo "✓ Bucket access verified"
echo ""

# Function to upload directory with progress
upload_dir() {
    local src="$1"
    local dest="$2"
    local desc="$3"
    
    if [ ! -d "$src" ]; then
        echo "⚠️  Skipping $desc: directory not found at $src"
        return
    fi
    
    local count=$(find "$src" -type f | wc -l | xargs)
    echo "📦 Uploading $desc ($count files)..."
    echo "   From: $src"
    echo "   To: gs://${BUCKET}/${dest}"
    
    gsutil -m -h "Cache-Control:${CACHE_CONTROL}" \
        rsync -r -x ".*\.DS_Store$" \
        "$src" "gs://${BUCKET}/${dest}"
    
    echo "✓ $desc uploaded successfully"
    echo ""
}

# Function to upload single file
upload_file() {
    local src="$1"
    local dest="$2"
    local desc="$3"
    
    if [ ! -f "$src" ]; then
        echo "⚠️  Skipping $desc: file not found at $src"
        return
    fi
    
    echo "📄 Uploading $desc..."
    echo "   From: $src"
    echo "   To: gs://${BUCKET}/${dest}"
    
    gsutil -h "Cache-Control:${CACHE_CONTROL}" \
        cp "$src" "gs://${BUCKET}/${dest}"
    
    echo "✓ $desc uploaded"
    echo ""
}

# Make all uploaded files publicly readable
make_public() {
    local path="$1"
    echo "🔓 Making $path publicly readable..."
    gsutil -m acl ch -r -u AllUsers:R "gs://${BUCKET}/${path}" || true
    echo ""
}

# 1. Upload public/images (product images)
echo "=== Phase 1: Product Images ==="
upload_dir "public/images" "static/images" "product images"
make_public "static/images"

# 2. Upload fonts
echo "=== Phase 2: Fonts ==="
upload_dir "fonts" "static/fonts" "font files"
make_public "static/fonts"

# 3. Upload root-level essential images
echo "=== Phase 3: Root-level Images ==="
upload_file "ordertech.png" "static/ordertech.png" "OrderTech logo"
upload_file "placeholder.jpg" "static/placeholder.jpg" "Placeholder image"
upload_file "poster-defualt.png" "static/poster-defualt.png" "Default poster"

# Optional: upload other root images if they exist
if [ -f "iced-americano.jpg" ]; then
    upload_file "iced-americano.jpg" "static/iced-americano.jpg" "Sample image"
fi
if [ -f "Black-Spanish.jpg" ]; then
    upload_file "Black-Spanish.jpg" "static/Black-Spanish.jpg" "Sample image"
fi

make_public "static/*.png"
make_public "static/*.jpg"

# 4. Verify uploads
echo "=== Verification ==="
echo "Listing uploaded assets..."
echo ""

echo "Images:"
gsutil ls "gs://${BUCKET}/static/images/" | head -10
echo "   ... (showing first 10)"
echo ""

echo "Fonts:"
gsutil ls -r "gs://${BUCKET}/static/fonts/"
echo ""

echo "Root files:"
gsutil ls "gs://${BUCKET}/static/*.png" "gs://${BUCKET}/static/*.jpg" 2>/dev/null || true
echo ""

echo "=== Migration Complete ==="
echo ""
echo "Assets are now available at:"
echo "  Images: https://storage.googleapis.com/${BUCKET}/static/images/"
echo "  Fonts:  https://storage.googleapis.com/${BUCKET}/static/fonts/"
echo "  Root:   https://storage.googleapis.com/${BUCKET}/static/"
echo ""
echo "Next steps:"
echo "  1. Update server.js to redirect to GCS URLs"
echo "  2. Update css/fonts.css font paths"
echo "  3. Test locally with NODE_ENV=production"
echo "  4. Deploy to staging"
