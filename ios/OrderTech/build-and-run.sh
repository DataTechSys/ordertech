#!/bin/bash
set -e

SIMULATOR_ID="CDAB1A56-263D-437B-A204-8420F1453F55"

echo "Starting simulator..."
xcrun simctl boot "$SIMULATOR_ID" 2>/dev/null || true
open -a Simulator
sleep 3

echo "Building OrderTech with VLC support..."
xcodebuild -workspace OrderTech.xcworkspace \
  -scheme OrderTech \
  -sdk iphonesimulator \
  -destination 'id=CDAB1A56-263D-437B-A204-8420F1453F55' \
  -configuration Debug \
  build

echo "Installing app on simulator..."
APP_PATH="$(find ~/Library/Developer/Xcode/DerivedData/OrderTech-*/Build/Products/Debug-iphonesimulator -name "OrderTech.app" -type d -exec test -e "{}/Info.plist" \; -print | sort -r | head -1)"
xcrun simctl install booted "$APP_PATH"

echo "Launching OrderTech..."
xcrun simctl launch --console booted me.ordertech.app

echo "Done! App is running with RTSP/VLC support."
