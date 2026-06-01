#!/usr/bin/env bash
# Hashes all extension source files and writes build-info.json.
# Run after editing any file under extension/ to refresh the in-app fingerprint.
set -euo pipefail

EXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$EXT_DIR"

# Hash every tracked source file except build-info.json itself and packaging artefacts.
HASH=$(find . -type f \
  \( -name '*.js' -o -name '*.html' -o -name '*.css' -o -name '*.json' -o -name '*.png' -o -name '*.svg' \) \
  ! -name 'build-info.json' \
  ! -path './scripts/*' \
  ! -path './*.zip' \
  -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -c1-12)

BUILT_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
VERSION=$(grep -oE '"version"\s*:\s*"[^"]+"' manifest.json | head -1 | sed -E 's/.*"([^"]+)"$/\1/')

cat > build-info.json <<EOF
{
  "version": "${VERSION}",
  "hash": "${HASH}",
  "builtAt": "${BUILT_AT}"
}
EOF

echo "build-info.json updated: v${VERSION} build ${HASH} @ ${BUILT_AT}"
