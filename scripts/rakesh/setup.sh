#!/usr/bin/env bash
# One command to go from a fresh clone to an installed "T3 Code (Rakesh)" with
# nightly updates. Installs Node 24 (Homebrew) and an isolated Rust toolchain
# if missing, creates the signing identity, builds, installs and loads the
# nightly LaunchAgent. Needs: Apple Silicon Mac, Xcode Command Line Tools,
# Homebrew. Re-running is safe.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

[[ "$(uname -m)" == arm64 ]] || {
  echo "setup.sh: needs an Apple Silicon Mac" >&2
  exit 1
}
xcode-select -p >/dev/null 2>&1 || {
  echo "setup.sh: run 'xcode-select --install' first" >&2
  exit 1
}
[[ -x /opt/homebrew/bin/brew ]] || {
  echo "setup.sh: install Homebrew first (https://brew.sh)" >&2
  exit 1
}

[[ -x /opt/homebrew/opt/node@24/bin/node ]] || /opt/homebrew/bin/brew install node@24
[[ -x /opt/homebrew/opt/node@24/bin/pnpm ]] || /opt/homebrew/opt/node@24/bin/corepack enable
if [[ ! -x "$CARGO_HOME/bin/cargo" ]]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    sh -s -- -y --no-modify-path --default-toolchain stable
fi

"$RAKESH_REPO_ROOT/scripts/rakesh/setup-signing.sh"
"$RAKESH_REPO_ROOT/scripts/rakesh/build.sh"
"$RAKESH_REPO_ROOT/scripts/rakesh/install.sh"
"$RAKESH_REPO_ROOT/scripts/rakesh/install-launch-agent.sh"
echo "setup.sh: done. Open \"$RAKESH_APP_NAME\" from Applications."
