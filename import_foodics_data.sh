#!/bin/bash

# import_foodics_data.sh
# Script to trigger Foodics data import for Koobs tenant

echo "🚀 Importing Foodics Data for Koobs"
echo "===================================="

TENANT_ID="494675"
BASE_URL="https://app.ordertech.me"

echo ""
echo "📋 Tenant: Koobs ($TENANT_ID)"
echo "🌐 Server: $BASE_URL"

# Note: This endpoint requires admin authentication
# You'll need to run this from your browser's console with proper auth cookies
echo ""
echo "⚠️  To trigger Foodics import, you need to:"
echo ""
echo "1. Open your browser and login to:"
echo "   ${BASE_URL}/tenants/${TENANT_ID}"
echo ""
echo "2. Open browser Developer Tools (F12) and go to Console tab"
echo ""
echo "3. Run this JavaScript command:"
echo ""
echo "   fetch('/admin/tenants/${TENANT_ID}/integrations/foodics/sync', {"
echo "     method: 'POST',"
echo "     headers: { 'Content-Type': 'application/json' },"
echo "     body: JSON.stringify({ force_images: true })"
echo "   })"
echo "   .then(r => r.json())"
echo "   .then(data => console.log('Sync result:', data))"
echo "   .catch(err => console.error('Sync error:', err))"
echo ""
echo "4. This will import products, modifiers, and categories from Foodics"
echo ""

# Alternative: Check if there's a specific sales endpoint
echo "🔍 Checking for sales data endpoints..."

# Try to call the sales-orders endpoint the unified page uses
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/admin/tenants/${TENANT_ID}/sales-orders?limit=1")

if [ "$RESPONSE" = "401" ] || [ "$RESPONSE" = "403" ]; then
    echo "✅ Sales orders endpoint exists but requires authentication"
elif [ "$RESPONSE" = "404" ]; then
    echo "❌ Sales orders endpoint not found - may need to be created"
else
    echo "📊 Sales orders endpoint responded with status: $RESPONSE"
fi

echo ""
echo "📝 Next Steps:"
echo "1. Run the Foodics sync from browser console (above)"
echo "2. Check if sales data import endpoint exists"
echo "3. If not, we may need to add a sales import endpoint"
echo "4. Once data is imported, refresh the unified orders page:"
echo "   ${BASE_URL}/unified-orders.html?id=${TENANT_ID}"

echo ""
echo "🎯 Goal: Import real Foodics orders data to display in unified view"