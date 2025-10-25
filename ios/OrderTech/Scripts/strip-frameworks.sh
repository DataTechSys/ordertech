#!/bin/bash
set -e

# Strip unused architectures from embedded frameworks to avoid App Store rejection
# This script processes all .framework bundles in the app's Frameworks folder

FRAMEWORKS_DIR="${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}"

if [ -d "${FRAMEWORKS_DIR}" ]; then
  echo "Checking frameworks in: ${FRAMEWORKS_DIR}"
  
  find "${FRAMEWORKS_DIR}" -name "*.framework" -type d | while read -r framework; do
    framework_name=$(basename "${framework}" .framework)
    binary="${framework}/${framework_name}"
    
    if [ -f "${binary}" ]; then
      echo "Processing: ${framework_name}"
      
      # Show current architectures
      lipo -info "${binary}" 2>/dev/null || echo "  Unable to read architectures"
      
      # Extract valid architectures for the current build
      if [ "${ARCHS}" != "" ]; then
        echo "  Target architectures: ${ARCHS}"
        
        # Create a temporary binary with only the required architectures
        temp_binary="${binary}.tmp"
        extracted_archs=""
        
        for arch in ${ARCHS}; do
          if lipo -info "${binary}" 2>/dev/null | grep -q "${arch}"; then
            extracted_archs="${extracted_archs} ${arch}"
          fi
        done
        
        if [ "${extracted_archs}" != "" ]; then
          echo "  Extracting architectures:${extracted_archs}"
          lipo -extract ${extracted_archs} "${binary}" -output "${temp_binary}" 2>/dev/null || true
          
          if [ -f "${temp_binary}" ]; then
            mv "${temp_binary}" "${binary}"
            echo "  ✓ Framework stripped successfully"
          fi
        fi
      fi
    fi
  done
  
  echo "Framework stripping complete"
else
  echo "No frameworks directory found at: ${FRAMEWORKS_DIR}"
fi
