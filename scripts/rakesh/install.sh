#!/usr/bin/env bash
# Installs the app build.sh produced. The previous copy is kept as
# "<target>.prev" for rollback. The official T3 Code app is never touched.
#   install.sh [target]   default target: /Applications/T3 Code (Rakesh).app
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

source_app="${RAKESH_SOURCE_APP:-$RAKESH_RELEASE_DIR/$RAKESH_APP_NAME.app}"
target="${1:-$RAKESH_INSTALL_PATH}"

case "$(basename "$target")" in
  "$RAKESH_APP_NAME.app") ;;
  *)
    echo "install.sh: refusing to install over $target" >&2
    exit 1
    ;;
esac
[[ -d "$source_app" ]] || {
  echo "install.sh: no build at $source_app; run build.sh first" >&2
  exit 1
}
if rakesh_app_running; then
  echo "install.sh: $RAKESH_APP_NAME is running; quit it first" >&2
  exit 1
fi

staging="$target.new"
rm -rf "$staging"
ditto "$source_app" "$staging"
xattr -dr com.apple.quarantine "$staging" 2>/dev/null || true

if [[ -d "$target" ]]; then
  rm -rf "$target.prev"
  mv "$target" "$target.prev"
fi
mv "$staging" "$target"

echo "install.sh: installed $target"
