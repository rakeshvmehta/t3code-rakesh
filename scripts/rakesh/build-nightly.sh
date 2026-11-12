#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

export RAKESH_APP_NAME='T3 Code (Rakesh Nightly)'
export RAKESH_BUNDLE_ID='com.rakesh.t3code.nightly'
export RAKESH_RELEASE_DIR="$RAKESH_REPO_ROOT/release-rakesh-nightly"
export RAKESH_BUILD_TAG
RAKESH_BUILD_TAG="$(git -C "$RAKESH_REPO_ROOT" describe --tags --abbrev=0 --match 'v[0-9]*-nightly.*' HEAD)"

exec /bin/bash "$RAKESH_REPO_ROOT/scripts/rakesh/build.sh"
