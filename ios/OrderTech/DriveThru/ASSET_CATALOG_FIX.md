# Asset Catalog Fix - DriveThru App

## Problem
App icon and modifier icons (espresso, milk) not showing in the DriveThru iOS app.

## Root Cause
XcodeGen does not automatically add asset catalogs to the PBXResourcesBuildPhase, causing them to not be compiled into the `.app` bundle. The asset catalog exists in the project but is never included in the build.

## Solution

### 1. Ensure Asset Catalog Exists
```bash
ls -la Resources/DriveThruAssets.xcassets/
```

Should contain:
- `AppIcon.appiconset/` (with icon-1024.png and all sizes)
- `espresso.imageset/`
- `milk.imageset/`
- Any other image assets

### 2. Add Asset Catalog to Build Phase

After running `xcodegen generate`, the asset catalog must be manually added to the Resources build phase:

```bash
cd /Users/mosawi/DATATECH/OrderTech/ios/OrderTech/DriveThru

python3 << 'PYTHON'
import re
import hashlib

pbxproj = "DriveThru.xcodeproj/project.pbxproj"
with open(pbxproj, "r") as f:
    content = f.read()

# Find the asset catalog file reference UUID
match = re.search(r'([A-F0-9]{24}) /\* DriveThruAssets\.xcassets \*/', content)
if not match:
    print("❌ Asset catalog not found in project")
    exit(1)

asset_uuid = match.group(1)
print(f"✓ Found asset catalog UUID: {asset_uuid}")

# Check if already in build phase
if f"{asset_uuid} /* DriveThruAssets.xcassets in Resources */" in content:
    print("✓ Asset catalog already in Resources build phase")
    exit(0)

# Generate UUID for build file
build_uuid = hashlib.md5(f"DriveThruAssets-build-{asset_uuid}".encode()).hexdigest()[:24].upper()

# Add PBXBuildFile entry
pbx_build_file_section = re.search(r'/\* Begin PBXBuildFile section \*/\n', content)
if pbx_build_file_section:
    insert_pos = pbx_build_file_section.end()
    build_file_entry = f"\t\t{build_uuid} /* DriveThruAssets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {asset_uuid} /* DriveThruAssets.xcassets */; }};\n"
    content = content[:insert_pos] + build_file_entry + content[insert_pos:]
    print("✓ Added PBXBuildFile entry")

# Add to Resources build phase
resources_match = re.search(r'(PBXResourcesBuildPhase.*?files = \(\n)(.*?)(\t\t\t\);)', content, re.DOTALL)
if resources_match:
    files_section = resources_match.group(2)
    new_entry = f"\t\t\t\t{build_uuid} /* DriveThruAssets.xcassets in Resources */,\n"
    updated_files = new_entry + files_section
    content = content[:resources_match.start(2)] + updated_files + content[resources_match.end(2):]
    print("✓ Added to Resources build phase")

with open(pbxproj, "w") as f:
    f.write(content)

print("✅ Asset catalog added to build phase successfully")
PYTHON
```

### 3. Clean and Rebuild

```bash
# Clean derived data
rm -rf ~/Library/Developer/Xcode/DerivedData/*

# Open workspace
open /Users/mosawi/DATATECH/OrderTech/ios/OrderTech.xcworkspace
```

In Xcode:
1. Product → Clean Build Folder (Cmd+Shift+K)
2. Delete the DriveThru app from simulator/device completely
3. Build and run

### 4. Verify Build Output

After building, check that Assets.car exists:

```bash
find ~/Library/Developer/Xcode/DerivedData -name "DriveThru.app" -type d | head -1 | xargs -I {} ls -la {}/ | grep Assets.car
```

Should show `Assets.car` in the app bundle.

## Quick Fix Script

Save this as `fix_assets.sh`:

```bash
#!/bin/bash
set -e

echo "🔧 Fixing DriveThru asset catalog..."

cd /Users/mosawi/DATATECH/OrderTech/ios/OrderTech/DriveThru

# Run the Python fix
python3 << 'PYTHON'
import re, hashlib

pbxproj = "DriveThru.xcodeproj/project.pbxproj"
with open(pbxproj, "r") as f:
    content = f.read()

match = re.search(r'([A-F0-9]{24}) /\* DriveThruAssets\.xcassets \*/', content)
if not match:
    print("❌ Asset catalog not found")
    exit(1)

asset_uuid = match.group(1)
if f"{asset_uuid} /* DriveThruAssets.xcassets in Resources */" in content:
    print("✓ Already fixed")
    exit(0)

build_uuid = hashlib.md5(f"DriveThruAssets-build-{asset_uuid}".encode()).hexdigest()[:24].upper()

# Add build file
pbx_build_file_section = re.search(r'/\* Begin PBXBuildFile section \*/\n', content)
if pbx_build_file_section:
    insert_pos = pbx_build_file_section.end()
    build_file_entry = f"\t\t{build_uuid} /* DriveThruAssets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {asset_uuid} /* DriveThruAssets.xcassets */; }};\n"
    content = content[:insert_pos] + build_file_entry + content[insert_pos:]

# Add to resources phase
resources_match = re.search(r'(PBXResourcesBuildPhase.*?files = \(\n)(.*?)(\t\t\t\);)', content, re.DOTALL)
if resources_match:
    files_section = resources_match.group(2)
    new_entry = f"\t\t\t\t{build_uuid} /* DriveThruAssets.xcassets in Resources */,\n"
    updated_files = new_entry + files_section
    content = content[:resources_match.start(2)] + updated_files + content[resources_match.end(2):]

with open(pbxproj, "w") as f:
    f.write(content)

print("✅ Fixed")
PYTHON

echo "🧹 Cleaning build cache..."
rm -rf ~/Library/Developer/Xcode/DerivedData/*

echo "✅ Done! Now clean build in Xcode and delete the app before running."
```

Make executable: `chmod +x fix_assets.sh`

## When to Run This Fix

- After running `xcodegen generate`
- When app icon or image assets don't appear in the built app
- When you see: `No image named 'X' found in asset catalog`

## Prevention

Currently, XcodeGen doesn't properly handle asset catalog build phase inclusion. This fix must be run after every `xcodegen generate` until the project.yml configuration is updated or XcodeGen behavior changes.

---

**Last Fixed:** 2025-11-01  
**Project:** DriveThru iOS App  
**Asset Catalog:** Resources/DriveThruAssets.xcassets
