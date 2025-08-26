#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [[ -z "${ROOT}" ]]; then
  echo "Error: not inside a git repository" >&2
  exit 1
fi
cd "$ROOT"

CMD=${1:-help}
case "$CMD" in
  list)
    # List annotated snapshot tags newest first, with timestamp and subject
    git tag --list 'snapshot-*' --sort=-taggerdate | while read -r t; do
      [[ -z "$t" ]] && continue
      ts=$(git for-each-ref "refs/tags/$t" --format='%(taggerdate:iso8601)' 2>/dev/null || true)
      if [[ -z "$ts" ]]; then
        ts=$(git log -1 --date=iso-strict --format=%cd "$t" 2>/dev/null || true)
      fi
      msg=$(git for-each-ref "refs/tags/$t" --format='%(contents:subject)' 2>/dev/null || true)
      if [[ -z "$msg" ]]; then
        msg=$(git log -1 --format=%s "$t" 2>/dev/null || true)
      fi
      printf "%s  %s  - %s\n" "$t" "$ts" "$msg"
    done
    ;;
  current)
    head=$(git rev-parse --short HEAD)
    tag=$(git tag --points-at HEAD | grep '^snapshot-' || true)
    branch=$(git rev-parse --abbrev-ref HEAD)
    echo "HEAD=$head branch=$branch tag=${tag:-none}"
    ;;
  switch)
    tag=${2:-}
    if [[ -z "$tag" ]]; then
      echo "Usage: $0 switch <snapshot-tag> [--no-restart]" >&2
      exit 1
    fi
    if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
      echo "Tag not found: $tag" >&2
      exit 1
    fi
    git checkout -B working "$tag"
    if [[ "${3:-}" != "--no-restart" ]]; then
      launchctl kickstart -k "gui/$(id -u)/com.smartorder.server" || true
    fi
    ;;
  prev)
    mapfile -t tags < <(git tag --list 'snapshot-*' --sort=-taggerdate)
    if (( ${#tags[@]} == 0 )); then
      echo "No snapshot-* tags" >&2
      exit 1
    fi
    head_commit=$(git rev-parse HEAD)
    idx=-1
    for i in "${!tags[@]}"; do
      if [[ "$(git rev-parse "${tags[$i]}")" == "$head_commit" ]]; then idx=$i; break; fi
    done
    if (( idx < 0 )); then
      # Not currently at a snapshot tag: treat 'prev' as going to the latest snapshot
      idx=-1
    fi
    next_idx=$((idx+1))
    if (( next_idx >= ${#tags[@]} )); then
      echo "Already at oldest snapshot" >&2
      exit 1
    fi
    sel_tag="${tags[$next_idx]}"
    echo "Switching to $sel_tag"
    git checkout -B working "$sel_tag"
    if [[ "${2:-}" != "--no-restart" ]]; then
      launchctl kickstart -k "gui/$(id -u)/com.smartorder.server" || true
    fi
    ;;
  help|*)
    cat <<'EOF'
Usage:
  scripts/versions.sh list                  # list snapshot tags (newest first)
  scripts/versions.sh current               # show current HEAD/branch/tag
  scripts/versions.sh switch <tag> [--no-restart]
  scripts/versions.sh prev [--no-restart]

Conventions:
  - Snapshot tags named snapshot-YYYYMMDD-HHMMSS
  - Server restart: launchctl kickstart -k gui/$(id -u)/com.smartorder.server
EOF
    ;;
esac

