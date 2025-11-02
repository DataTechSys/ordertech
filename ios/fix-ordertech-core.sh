#!/bin/bash

echo "🔧 Fixing OrderTechCore Package Conflict..."
echo ""

# Close Xcode
echo "⚠️  Please close Xcode completely before continuing."
read -p "Press Enter when Xcode is closed..."

# Clean Swift PM caches
echo "🧹 Cleaning Swift Package Manager caches..."
rm -rf ~/Library/Developer/Xcode/DerivedData/OrderTech-*
rm -rf ~/Library/Developer/Xcode/DerivedData/DriveThru-*
rm -rf ~/Library/Caches/org.swift.swiftpm/
rm -rf ~/.swiftpm/

# Clean workspace package resolved files
echo "🧹 Cleaning workspace Package.resolved files..."
rm -f /Users/mosawi/DATATECH/OrderTech/ios/OrderTech.xcworkspace/xcshareddata/swiftpm/Package.resolved
rm -f /Users/mosawi/DATATECH/OrderTech/ios/OrderTech/OrderTech.xcworkspace/xcshareddata/swiftpm/Package.resolved

# Clean project package resolved files  
echo "🧹 Cleaning project Package.resolved files..."
rm -f /Users/mosawi/DATATECH/OrderTech/ios/OrderTech.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
rm -f /Users/mosawi/DATATECH/OrderTech/ios/OrderTech/OrderTech.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved

# Clean build folders
echo "🧹 Cleaning build folders..."
rm -rf /Users/mosawi/DATATECH/OrderTech/ios/OrderTech/build
rm -rf /Users/mosawi/DATATECH/OrderTech/ios/DriveThru/build

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Open the workspace:"
echo "   cd /Users/mosawi/DATATECH/OrderTech/ios/OrderTech"
echo "   open OrderTech.xcworkspace"
echo ""
echo "2. Wait for Xcode to resolve packages (may take a minute)"
echo "3. Select the scheme you want (OrderTech or DriveThru)"
echo "4. Build with ⌘B"
echo ""
echo "The OrderTechCore conflict should now be resolved! 🎉"
