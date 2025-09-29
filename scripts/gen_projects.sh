#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "XcodeGen not found. Install via: brew install xcodegen" >&2
  exit 1
fi

# Generate CashierApp (existing project.yml already present)
if [ -f CashierApp/project.yml ]; then
  echo "[gen] CashierApp"
  xcodegen generate --spec CashierApp/project.yml --project CashierApp/CashierApp.xcodeproj
fi

# Generate DisplayApp
if [ -f DisplayApp/project.yml ]; then
  echo "[gen] DisplayApp"
  xcodegen generate --spec DisplayApp/project.yml
fi

echo "Done. Open with: open DisplayApp/DisplayApp.xcodeproj"
