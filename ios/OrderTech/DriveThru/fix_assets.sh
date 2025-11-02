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
