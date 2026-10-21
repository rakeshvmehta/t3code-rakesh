# Shared toolchain environment for the Rakesh build scripts. Source, don't run.
# Node 24 and an isolated Rust toolchain are PATH-prefixed here only, so the
# user's default `node` (26) and Homebrew `rustc` stay untouched.
RAKESH_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RAKESH_TOOLS_HOME="$HOME/.local/share/t3code-rakesh"
export RUSTUP_HOME="$RAKESH_TOOLS_HOME/rustup"
export CARGO_HOME="$RAKESH_TOOLS_HOME/cargo"
export PATH="$RAKESH_REPO_ROOT/node_modules/.bin:/opt/homebrew/opt/node@24/bin:$CARGO_HOME/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export T3CODE_DESKTOP_SIGNED=false

RAKESH_RELEASE_DIR="$RAKESH_REPO_ROOT/release-rakesh"

# Latest stable (non-prerelease) upstream tag reachable from HEAD, e.g. v0.1.1.
rakesh_base_tag() {
  git -C "$RAKESH_REPO_ROOT" describe --tags --abbrev=0 --match 'v[0-9]*' --exclude '*-*' HEAD
}
