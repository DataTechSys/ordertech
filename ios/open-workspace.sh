#!/bin/bash

echo "🔍 Verifying workspace structure..."
echo ""

# Check workspace exists
if [ -f "OrderTech.xcworkspace/contents.xcworkspacedata" ]; then
    echo "✅ Workspace found at: $(pwd)/OrderTech.xcworkspace"
else
    echo "❌ Workspace not found!"
    exit 1
fi

# Check projects exist
echo ""
echo "📦 Checking projects..."

if [ -d "OrderTech/OrderTech.xcodeproj" ]; then
    echo "✅ OrderTech project exists"
else
    echo "❌ OrderTech project missing!"
fi

if [ -d "OrderTech/DriveThru/DriveThru.xcodeproj" ]; then
    echo "✅ DriveThru project exists"
else
    echo "❌ DriveThru project missing!"
fi

# Show workspace contents
echo ""
echo "📝 Workspace contains:"
cat OrderTech.xcworkspace/contents.xcworkspacedata

echo ""
echo "🚀 Opening workspace in Xcode..."
echo "   Location: $(pwd)/OrderTech.xcworkspace"
echo ""

# Kill Xcode if running
killall Xcode 2>/dev/null
sleep 1

# Open workspace
open OrderTech.xcworkspace

echo ""
echo "✅ Workspace opened!"
echo ""
echo "👀 What you should see in Xcode navigator:"
echo "   📁 OrderTechCore"
echo "   🔷 OrderTech"
echo "   🔷 DriveThru"
echo ""
echo "🎯 To switch schemes:"
echo "   Click scheme selector (next to Run ▶️ button)"
echo "   Choose: OrderTech or DriveThru"
echo ""
echo "If DriveThru still doesn't appear:"
echo "1. File → Close Workspace"
echo "2. Run this script again"
echo "3. In Xcode: File → Workspace Settings → Derived Data → Delete..."
