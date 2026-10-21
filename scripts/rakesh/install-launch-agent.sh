#!/usr/bin/env bash
# Installs and loads the nightly LaunchAgent (04:00, with install retries at
# 04:30, 05:00 and 05:30). Re-running replaces the loaded job.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

label="com.rakesh.t3code.nightly"
dest="$HOME/Library/LaunchAgents/$label.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$RAKESH_LOG_DIR"
sed -e "s#__REPO__#$RAKESH_REPO_ROOT#g" -e "s#__HOME__#$HOME#g" \
  "$RAKESH_REPO_ROOT/scripts/rakesh/$label.plist" >"$dest"
plutil -lint "$dest" >/dev/null

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$dest"
echo "install-launch-agent.sh: loaded $label from $dest"
