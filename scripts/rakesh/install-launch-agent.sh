#!/usr/bin/env bash
# Installs and loads the nightly LaunchAgent. The maintainer checkout (with an
# `upstream` remote) runs at 04:00; follower clones run at 05:00, after the
# maintainer has published. Each has install retries every 30 minutes for two
# hours. Re-running replaces the loaded job.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

label="com.rakesh.t3code.nightly"
dest="$HOME/Library/LaunchAgents/$label.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$RAKESH_LOG_DIR"
if git -C "$RAKESH_REPO_ROOT" remote get-url upstream >/dev/null 2>&1; then
  h0=4
else
  h0=5
fi
sed -e "s#__REPO__#$RAKESH_REPO_ROOT#g" -e "s#__HOME__#$HOME#g" \
  -e "s#__H0__#$h0#g" -e "s#__H1__#$((h0 + 1))#g" \
  "$RAKESH_REPO_ROOT/scripts/rakesh/$label.plist" >"$dest"
plutil -lint "$dest" >/dev/null

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$dest"
echo "install-launch-agent.sh: loaded $label from $dest"
