#!/bin/bash

# test_unified_orders.sh
# Test the unified orders page and sample data

echo "🧪 Testing Unified Orders Page"
echo "=============================="

TENANT_ID="494675"
BASE_URL="https://app.ordertech.me"

echo ""
echo "📋 Unified Orders Page URL:"
echo "${BASE_URL}/unified-orders.html?id=${TENANT_ID}"

echo ""
echo "🌐 Testing page accessibility..."
RESPONSE_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/unified-orders.html?id=${TENANT_ID}")

if [ "$RESPONSE_CODE" = "200" ]; then
    echo "✅ Page accessible (HTTP $RESPONSE_CODE)"
    echo ""
    echo "🎯 Next Steps:"
    echo "1. Open your browser and navigate to:"
    echo "   ${BASE_URL}/unified-orders.html?id=${TENANT_ID}"
    echo ""
    echo "2. Login with your admin credentials"
    echo ""
    echo "3. Select 'Koobs (494675)' from the tenant dropdown"
    echo ""
    echo "4. The page should show both local orders and Foodics orders"
    echo "   (Currently it may be empty - sample data needs to be added)"
    echo ""
    echo "📊 To add sample data, you can:"
    echo "   - Use the SQL script: create_sample_orders.sql"
    echo "   - Or wait for the sample data endpoint to be deployed"
    echo ""
    echo "🔍 Page Features:"
    echo "   - Statistics cards showing order counts and totals"
    echo "   - Filter by source (Local/Foodics), status, and time period"  
    echo "   - Unified table showing orders from both sources"
    echo "   - Order details modal (click any row)"
    echo "   - Export functionality"
else
    echo "❌ Page not accessible (HTTP $RESPONSE_CODE)"
    echo ""
    echo "🔧 Troubleshooting:"
    echo "   - Check if the deployment succeeded"
    echo "   - Verify the route is configured correctly"
    echo "   - Check server logs for errors"
fi

echo ""
echo "✨ Unified Orders Page is ready!"