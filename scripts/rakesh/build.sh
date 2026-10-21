#!/usr/bin/env bash
# Builds "T3 Code (Rakesh)": unsigned macOS arm64, auto-update off.
# Output: release-rakesh/T3 Code (Rakesh).app (plus the zip electron-builder made).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$RAKESH_REPO_ROOT"

node -v | grep -q '^v24\.' || {
  echo "build.sh: Node 24 not found at /opt/homebrew/opt/node@24" >&2
  exit 1
}

export T3CODE_DESKTOP_APP_ID="$RAKESH_BUNDLE_ID"
export T3CODE_DESKTOP_PRODUCT_NAME="$RAKESH_APP_NAME"
# With no update feed baked in, the desktop updater reports "no update feed is
# configured" and never checks. These are the only inputs that would add one.
unset T3CODE_DESKTOP_UPDATE_REPOSITORY GITHUB_REPOSITORY GH_TOKEN GITHUB_TOKEN
export T3CODE_DESKTOP_MOCK_UPDATES=false

pnpm install --frozen-lockfile

echo "build.sh: running sidebar sections tests"
pnpm exec vp test run \
  apps/web/src/components/sidebarSections/ \
  apps/web/src/components/Sidebar.logic.test.ts \
  apps/web/src/components/Sidebar.drag.test.ts
(cd apps/web && pnpm exec vp test run --project browser src/components/Sidebar)
(cd scripts && pnpm exec vp test run --config ../vite.config.ts --dir . rakesh/identity.test.ts)

version="$(rakesh_base_tag)"
version="${version#v}"

rm -rf "$RAKESH_RELEASE_DIR"
node scripts/build-desktop-artifact.ts \
  --platform mac --target zip --arch arm64 \
  --build-version "$version" \
  --output-dir "$RAKESH_RELEASE_DIR"

zip_path="$(ls "$RAKESH_RELEASE_DIR"/*.zip | head -n 1)"
ditto -x -k "$zip_path" "$RAKESH_RELEASE_DIR"
app="$RAKESH_RELEASE_DIR/$RAKESH_APP_NAME.app"
[[ -d "$app" ]] || {
  echo "build.sh: expected $app" >&2
  exit 1
}

bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")"
[[ "$bundle_id" == "$RAKESH_BUNDLE_ID" ]] || {
  echo "build.sh: bundle id is $bundle_id, expected $RAKESH_BUNDLE_ID" >&2
  exit 1
}
if [[ -e "$app/Contents/Resources/app-update.yml" ]]; then
  echo "build.sh: app-update.yml present; auto-update would be enabled" >&2
  exit 1
fi

# electron-builder leaves an unsigned build with only Electron's linker
# signature, which does not seal the bundle. Seal it ad hoc so it verifies.
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"

echo "build.sh: built $app ($version)"
