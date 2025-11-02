#!/bin/bash
set -e

echo "🧹 Cleaning build artifacts..."
rm -rf ~/Library/Developer/Xcode/DerivedData/*
xcodebuild clean -workspace ../OrderTech.xcworkspace -scheme DriveThru 2>/dev/null || true

echo "🔨 Building fresh..."
xcodebuild -workspace ../OrderTech.xcworkspace -scheme DriveThru -destination 'platform=iOS Simulator,name=iPhone 15 Pro' clean build

echo "✅ Build complete"
echo ""
echo "📱 Next steps:"
echo "1. DELETE the DriveThru app from your simulator/device completely"
echo "2. Relaunch from Xcode"
echo ""
