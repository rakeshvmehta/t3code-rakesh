#!/usr/bin/env bash
# Builds the unsigned macOS arm64 desktop app into release-rakesh/.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$RAKESH_REPO_ROOT"

node -v | grep -q '^v24\.' || { echo "build.sh: Node 24 not found at /opt/homebrew/opt/node@24" >&2; exit 1; }

pnpm install --frozen-lockfile

version="$(rakesh_base_tag)"
version="${version#v}"

rm -rf "$RAKESH_RELEASE_DIR"
node scripts/build-desktop-artifact.ts \
  --platform mac --target zip --arch arm64 \
  --build-version "$version" \
  --output-dir "$RAKESH_RELEASE_DIR"

ls "$RAKESH_RELEASE_DIR"/*.zip
