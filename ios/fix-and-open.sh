#!/bin/bash

echo "🔧 Complete Fix for OrderTech Workspace"
echo "========================================"
echo ""

# Close Xcode
echo "📍 Step 1: Closing Xcode..."
killall Xcode 2>/dev/null
sleep 2

# Clean all caches
echo "🧹 Step 2: Cleaning caches..."
rm -rf ~/Library/Developer/Xcode/DerivedData/OrderTech-*
rm -rf ~/Library/Developer/Xcode/DerivedData/DriveThru-*
rm -rf ~/Library/Caches/org.swift.swiftpm/

# Clean package resolved files
echo "🧹 Step 3: Cleaning package files..."
find /Users/mosawi/DATATECH/OrderTech/ios -name "Package.resolved" -delete 2>/dev/null

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "📂 Opening correct workspace..."
echo "   Location: /Users/mosawi/DATATECH/OrderTech/ios/OrderTech.xcworkspace"
echo ""

# Open the workspace
cd /Users/mosawi/DATATECH/OrderTech/ios
open OrderTech.xcworkspace

sleep 3

echo ""
echo "✅ Workspace opened!"
echo ""
echo "📋 What to do in Xcode:"
echo ""
echo "1️⃣  Wait for package resolution to complete (progress bar at top)"
echo ""
echo "2️⃣  Select DriveThru scheme from scheme selector"
echo ""
echo "3️⃣  If you see signing error:"
echo "    • Click on DriveThru project in navigator"
echo "    • Select DriveThru target"
echo "    • Go to 'Signing & Capabilities' tab"
echo "    • Ensure 'Automatically manage signing' is checked"
echo "    • Team should be: 587PC6459F"
echo ""
echo "4️⃣  Build: ⌘B"
echo ""
echo "5️⃣  Run: ⌘R"
echo ""
echo "🎯 Your app icon should now appear!"
echo ""
