#!/usr/bin/env bash
# Installs and loads the stable-release updater. The maintainer checkout (with an
# `upstream` remote) runs at 04:00; follower clones run at 05:00, after the
# maintainer has published. Each has install retries every 30 minutes for two
# hours. Re-running replaces the loaded job.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

label="com.rakesh.t3code.stable-update"
legacy_label="com.rakesh.t3code.nightly"
dest="$HOME/Library/LaunchAgents/$label.plist"
legacy_dest="$HOME/Library/LaunchAgents/$legacy_label.plist"
temporary="$dest.new.$$"
previous="$dest.previous.$$"
mkdir -p "$HOME/Library/LaunchAgents" "$RAKESH_LOG_DIR"
trap 'rm -f "$temporary" "$previous"' EXIT
for job in "$label" "$legacy_label"; do
  if launchctl print "gui/$(id -u)/$job" 2>/dev/null |
    awk '/^[[:space:]]*pid = [0-9]+/ { found = 1 } END { exit !found }'; then
    echo "install-launch-agent.sh: updater is running; retry after it finishes" >&2
    exit 1
  fi
done
if git -C "$RAKESH_REPO_ROOT" remote get-url upstream >/dev/null 2>&1; then
  h0=4
else
  h0=5
fi
sed -e "s#__REPO__#$RAKESH_REPO_ROOT#g" -e "s#__HOME__#$HOME#g" \
  -e "s#__H0__#$h0#g" -e "s#__H1__#$((h0 + 1))#g" \
  "$RAKESH_REPO_ROOT/scripts/rakesh/$label.plist" >"$temporary"
plutil -lint "$temporary" >/dev/null
[[ ! -f "$dest" ]] || cp "$dest" "$previous"

launchctl bootout "gui/$(id -u)/$legacy_label" 2>/dev/null || true
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
mv "$temporary" "$dest"
if ! launchctl bootstrap "gui/$(id -u)" "$dest"; then
  rm -f "$dest"
  if [[ -f "$previous" ]]; then
    mv "$previous" "$dest"
    launchctl bootstrap "gui/$(id -u)" "$dest" || true
  elif [[ -f "$legacy_dest" ]]; then
    launchctl bootstrap "gui/$(id -u)" "$legacy_dest" || true
  fi
  echo "install-launch-agent.sh: registration failed; attempted to restore the previous job" >&2
  exit 1
fi
rm -f "$legacy_dest"
echo "install-launch-agent.sh: loaded $label from $dest"
