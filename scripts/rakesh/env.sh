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
RAKESH_APP_NAME="T3 Code (Rakesh)"
RAKESH_BUNDLE_ID="com.rakesh.t3code"
RAKESH_INSTALL_PATH="/Applications/$RAKESH_APP_NAME.app"
RAKESH_LOG_DIR="$HOME/Library/Logs/t3code-rakesh"
# Signing prefers a free "Apple Development" certificate (Xcode > Settings >
# Apple Accounts > Manage Certificates): macOS then remembers keychain access by
# team ID, so updates don't re-prompt. Without one, the personal self-signed
# identity (see scripts/rakesh/setup-signing.sh) is used and macOS asks once per
# new build. RAKESH_APPLE_IDENTITY may name a specific identity or SHA-1.
RAKESH_SIGNING_IDENTITY="T3 Code (Rakesh) Signing"
RAKESH_SIGNING_KEYCHAIN="$HOME/Library/Keychains/t3code-rakesh-signing.keychain-db"
RAKESH_SIGNING_PASSWORD_FILE="$HOME/Library/Application Support/t3code-rakesh/signing/keychain-password"

rakesh_app_running() {
  [[ "$(osascript -e "application id \"$RAKESH_BUNDLE_ID\" is running" 2>/dev/null)" == "true" ]]
}

rakesh_notify() {
  osascript -e "display notification \"$1\" with title \"$RAKESH_APP_NAME\"" >/dev/null 2>&1 || true
}

# Latest stable (non-prerelease) upstream tag reachable from HEAD, e.g. v0.1.1.
rakesh_base_tag() {
  git -C "$RAKESH_REPO_ROOT" describe --tags --abbrev=0 --match 'v[0-9]*' --exclude '*-*' HEAD
}

# RAKESH_APPLE_IDENTITY, else the first valid "Apple Development" identity's
# SHA-1, else nothing. Never fails, so callers fall back instead of exiting.
rakesh_apple_identity() {
  if [[ -n "${RAKESH_APPLE_IDENTITY:-}" ]]; then
    echo "$RAKESH_APPLE_IDENTITY"
    return
  fi
  security find-identity -v -p codesigning 2>/dev/null |
    awk '/"Apple Development: / { print $2; exit }' || true
}

# Signs an app bundle with the Apple Development identity, else the personal
# self-signed identity, else ad hoc.
rakesh_sign_app() {
  local app="$1" apple
  apple="$(rakesh_apple_identity)"
  if [[ -n "$apple" ]] && codesign --force --deep --sign "$apple" "$app"; then
    :
  elif [[ -f "$RAKESH_SIGNING_KEYCHAIN" && -f "$RAKESH_SIGNING_PASSWORD_FILE" ]]; then
    [[ -n "$apple" ]] && echo "rakesh: Apple Development signing failed; using the self-signed identity" >&2
    security unlock-keychain -p "$(cat "$RAKESH_SIGNING_PASSWORD_FILE")" "$RAKESH_SIGNING_KEYCHAIN"
    codesign --force --deep --keychain "$RAKESH_SIGNING_KEYCHAIN" \
      --sign "$RAKESH_SIGNING_IDENTITY" "$app"
  else
    echo "rakesh: no signing identity; signing ad hoc (keychain prompts after updates)" >&2
    codesign --force --deep --sign - "$app"
  fi
  codesign --verify --deep --strict "$app"
}
