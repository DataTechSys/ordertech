#!/bin/bash
# Fouzi Cafe Image Issue Diagnostic Script
# Uses curl to analyze image handling through API

BASE_URL="http://localhost:3000"
FOUZI_TENANT_ID="56ac557e-589d-4602-bc9b-946b201fb6f6"

echo "🔍 Fouzi Cafe Image Diagnostic Report"
echo "📅 Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "🔗 Using API proxy at: $BASE_URL"

# 1. Server Health Check
echo ""
echo "============================================================"
echo "  1. SERVER HEALTH CHECK"
echo "============================================================"

if curl -s "$BASE_URL/admin/tenants" > /tmp/tenants.json 2>/dev/null; then
    echo "✅ Server is accessible"
    
    # Check if Fouzi Cafe tenant exists
    if jq -e ".[] | select(.id == \"$FOUZI_TENANT_ID\")" /tmp/tenants.json > /tmp/fouzi_tenant.json 2>/dev/null; then
        echo "✅ Fouzi Cafe tenant found:"
        echo "   Name: $(jq -r '.name' /tmp/fouzi_tenant.json)"
        echo "   ID: $(jq -r '.id' /tmp/fouzi_tenant.json)"
        echo "   Domain: $(jq -r '.domain // "Not set"' /tmp/fouzi_tenant.json)"
        echo "   Slug: $(jq -r '.slug // "Not set"' /tmp/fouzi_tenant.json)"
    else
        echo "❌ Fouzi Cafe tenant not found"
        exit 1
    fi
else
    echo "❌ Server not accessible"
    exit 1
fi

# 2. Product Image Analysis
echo ""
echo "============================================================"
echo "  2. PRODUCT IMAGE ANALYSIS"
echo "============================================================"

if curl -s "$BASE_URL/admin/products?tenant_id=$FOUZI_TENANT_ID&limit=50" > /tmp/products.json 2>/dev/null; then
    TOTAL_PRODUCTS=$(jq '.items | length' /tmp/products.json)
    echo "📊 Total products found: $TOTAL_PRODUCTS"
    
    # Extract first 10 products for analysis
    jq '.items[0:10]' /tmp/products.json > /tmp/sample_products.json
    
    WITH_IMAGES=0
    WITHOUT_IMAGES=0
    FOODICS_IMAGES=0
    CLOUD_STORAGE_IMAGES=0
    OTHER_IMAGES=0
    
    echo ""
    echo "📋 Analyzing sample products:"
    
    # Process each product
    for i in $(seq 0 9); do
        PRODUCT=$(jq ".[$i]" /tmp/sample_products.json 2>/dev/null)
        if [ "$PRODUCT" != "null" ]; then
            PRODUCT_NAME=$(echo "$PRODUCT" | jq -r '.name')
            PRODUCT_ID=$(echo "$PRODUCT" | jq -r '.id')
            PRODUCT_SKU=$(echo "$PRODUCT" | jq -r '.sku // "N/A"')
            IMAGE_URL=$(echo "$PRODUCT" | jq -r '.image_url // empty')
            
            echo ""
            echo "📦 Product: $PRODUCT_NAME"
            echo "   ID: $PRODUCT_ID"
            echo "   SKU: $PRODUCT_SKU"
            
            if [ -n "$IMAGE_URL" ] && [ "$IMAGE_URL" != "null" ]; then
                ((WITH_IMAGES++))
                echo "   Image URL: $IMAGE_URL"
                
                # Categorize image source
                if [[ "$IMAGE_URL" == *"foodics"* ]] || [[ "$IMAGE_URL" == *"amazonaws"* ]]; then
                    ((FOODICS_IMAGES++))
                    echo "   📍 Type: External (Foodics/AWS)"
                    
                    # Test direct Foodics access
                    echo "   Testing direct access..."
                    if curl -I -s "$IMAGE_URL" | head -1 | grep -q "200 OK"; then
                        echo "   Direct access: ✅ (200)"
                        CONTENT_TYPE=$(curl -I -s "$IMAGE_URL" | grep -i "content-type:" | cut -d' ' -f2- | tr -d '\r')
                        if [ -n "$CONTENT_TYPE" ]; then
                            echo "   Content-Type: $CONTENT_TYPE"
                        fi
                    else
                        echo "   Direct access: ❌"
                    fi
                    
                    # Test image proxy
                    PROXY_URL="$BASE_URL/img?u=$(echo "$IMAGE_URL" | sed 's/&/%26/g' | sed 's/ /%20/g')"
                    echo "   Testing proxy access..."
                    if curl -I -s "$PROXY_URL" | head -1 | grep -q "200 OK"; then
                        echo "   Proxy access: ✅ (200)"
                        PROXY_CONTENT_TYPE=$(curl -I -s "$PROXY_URL" | grep -i "content-type:" | cut -d' ' -f2- | tr -d '\r')
                        PROXY_CACHE_CONTROL=$(curl -I -s "$PROXY_URL" | grep -i "cache-control:" | cut -d' ' -f2- | tr -d '\r')
                        if [ -n "$PROXY_CONTENT_TYPE" ]; then
                            echo "   Proxy Content-Type: $PROXY_CONTENT_TYPE"
                        fi
                        if [ -n "$PROXY_CACHE_CONTROL" ]; then
                            echo "   Proxy Cache-Control: $PROXY_CACHE_CONTROL"
                        fi
                    else
                        echo "   Proxy access: ❌"
                    fi
                    
                elif [[ "$IMAGE_URL" == *"storage.googleapis.com"* ]]; then
                    ((CLOUD_STORAGE_IMAGES++))
                    echo "   📍 Type: Cloud Storage (GCS)"
                    
                    if curl -I -s "$IMAGE_URL" | head -1 | grep -q "200 OK"; then
                        echo "   Cloud access: ✅ (200)"
                    else
                        echo "   Cloud access: ❌"
                    fi
                else
                    ((OTHER_IMAGES++))
                    echo "   📍 Type: Other"
                    
                    if curl -I -s "$IMAGE_URL" | head -1 | grep -q "200 OK"; then
                        echo "   Access: ✅ (200)"
                    else
                        echo "   Access: ❌"
                    fi
                fi
            else
                ((WITHOUT_IMAGES++))
                echo "   ❌ No image URL"
            fi
            
            # Small delay to avoid overwhelming servers
            sleep 0.1
        fi
    done
    
    # 3. Image Statistics Summary
    echo ""
    echo "============================================================"
    echo "  3. IMAGE STATISTICS SUMMARY"
    echo "============================================================"
    echo "📊 Total products: $TOTAL_PRODUCTS"
    echo "✅ Products with images: $WITH_IMAGES"
    echo "❌ Products without images: $WITHOUT_IMAGES"
    echo "🔗 External Foodics images: $FOODICS_IMAGES"
    echo "☁️  Cloud storage images: $CLOUD_STORAGE_IMAGES"
    echo "🔗 Other images: $OTHER_IMAGES"
    
else
    echo "❌ Failed to fetch products"
fi

# 4. Environment Configuration Check
echo ""
echo "============================================================"
echo "  4. ENVIRONMENT CONFIGURATION"
echo "============================================================"

# Test upload endpoint
echo "Testing cloud storage upload endpoint..."
UPLOAD_RESPONSE=$(curl -s -X POST "$BASE_URL/admin/upload-url" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$FOUZI_TENANT_ID\",\"filename\":\"test.jpg\",\"contentType\":\"image/jpeg\",\"kind\":\"product\"}" 2>/dev/null)

if echo "$UPLOAD_RESPONSE" | jq -e '.publicUrl' > /dev/null 2>&1; then
    echo "✅ Cloud storage upload endpoint working"
    PUBLIC_URL=$(echo "$UPLOAD_RESPONSE" | jq -r '.publicUrl')
    echo "📁 Upload URL pattern: Present"
    
    # Extract bucket name
    BUCKET_NAME=$(echo "$PUBLIC_URL" | sed -n 's|.*storage\.googleapis\.com/\([^/]*\).*|\1|p')
    if [ -n "$BUCKET_NAME" ]; then
        echo "🪣 Storage bucket: $BUCKET_NAME"
    fi
else
    echo "❌ Cloud storage upload endpoint failed"
    echo "Response: $UPLOAD_RESPONSE"
fi

# 5. Image Proxy Testing
echo ""
echo "============================================================"
echo "  5. IMAGE PROXY FUNCTIONALITY"
echo "============================================================"

TEST_IMAGE_URL="https://foodics-console-production.s3.eu-west-1.amazonaws.com/images/494675_1624994084_93cad784-50e2-4fe7-a97d-e61b7815efaa.jpg"
PROXY_TEST_URL="$BASE_URL/img?u=$(echo "$TEST_IMAGE_URL" | sed 's/&/%26/g')"

echo "🧪 Testing proxy with sample Foodics image..."
echo "Original URL: $TEST_IMAGE_URL"
echo "Proxy URL: $PROXY_TEST_URL"

if curl -I -s "$PROXY_TEST_URL" | head -1 | grep -q "200 OK"; then
    echo "Proxy result: ✅ (200)"
    PROXY_CONTENT_TYPE=$(curl -I -s "$PROXY_TEST_URL" | grep -i "content-type:" | cut -d' ' -f2- | tr -d '\r')
    PROXY_CACHE_CONTROL=$(curl -I -s "$PROXY_TEST_URL" | grep -i "cache-control:" | cut -d' ' -f2- | tr -d '\r')
    if [ -n "$PROXY_CONTENT_TYPE" ]; then
        echo "Content-Type: $PROXY_CONTENT_TYPE"
    fi
    if [ -n "$PROXY_CACHE_CONTROL" ]; then
        echo "Cache-Control: $PROXY_CACHE_CONTROL"
    fi
else
    echo "Proxy result: ❌"
fi

# 6. Recommendations
echo ""
echo "============================================================"
echo "  6. RECOMMENDATIONS"
echo "============================================================"

echo "Based on the analysis above, here are the key findings:"
echo ""

if [ $FOODICS_IMAGES -gt 0 ]; then
    echo "🔍 ISSUE IDENTIFIED: Products using external Foodics URLs"
    echo "   - These images are served from external AWS S3 bucket"
    echo "   - Should be migrated to your Google Cloud Storage bucket"
    echo "   - Image proxy is working as a temporary fallback"
    echo ""
    echo "📋 IMMEDIATE ACTIONS NEEDED:"
    echo "   1. Run Foodics sync with \"force_images=1\" parameter"
    echo "   2. Ensure Foodics API token is configured for tenant"
    echo "   3. Verify cloud storage permissions and bucket access"
    echo ""
    echo "🚀 NEXT STEPS:"
    echo "   1. Check Foodics integration status"
    echo "   2. Configure missing API credentials"
    echo "   3. Run image migration sync"
    echo "   4. Verify migrated images in cloud storage"
fi

if [ $CLOUD_STORAGE_IMAGES -gt 0 ]; then
    echo "✅ GOOD: Some images are already using cloud storage"
fi

if [ $WITHOUT_IMAGES -gt 0 ]; then
    echo "⚠️  WARNING: Some products have no images at all"
fi

echo ""
echo "============================================================"
echo "  7. COMPLETION"
echo "============================================================"
echo "🏁 Diagnostic complete"
echo "📄 Results have been logged above"
echo "💡 Use the recommendations section to resolve image issues"

# Cleanup
rm -f /tmp/tenants.json /tmp/fouzi_tenant.json /tmp/products.json /tmp/sample_products.json