#!/usr/bin/env bash
set -euo pipefail
xcodegen generate
python3 scripts/post_gen_fix.py || true