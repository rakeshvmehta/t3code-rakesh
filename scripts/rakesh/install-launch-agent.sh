#!/usr/bin/env bash
# Installs and loads the stable-release updater. The maintainer checkout (with an
# `upstream` remote) runs at 04:00; follower clones run at 05:00, after the
# maintainer has published. Each has install retries every 30 minutes for two
# hours. Re-running replaces the loaded job.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

channel="${1:-stable}"
requested_mode="${2:-auto}"
case "$channel" in
  stable) label=com.rakesh.t3code.stable-update; legacy_label=com.rakesh.t3code.nightly; maintainer_hour=4;;
  nightly) label=com.rakesh.t3code.t3rn-update; legacy_label=''; maintainer_hour=2;;
  *) echo 'Expected stable or nightly' >&2; exit 2;;
esac
case "$requested_mode" in
  auto|maintain|follow) ;;
  *) echo 'Expected auto, maintain, or follow mode' >&2; exit 2;;
esac
dest="$HOME/Library/LaunchAgents/$label.plist"
legacy_dest=''
[[ -z "$legacy_label" ]] || legacy_dest="$HOME/Library/LaunchAgents/$legacy_label.plist"
temporary="$dest.new.$$"
previous="$dest.previous.$$"
mkdir -p "$HOME/Library/LaunchAgents" "$RAKESH_LOG_DIR"
trap 'rm -f "$temporary" "$previous"' EXIT
for job in "$label" "$legacy_label"; do
  [[ -n "$job" ]] || continue
  if launchctl print "gui/$(id -u)/$job" 2>/dev/null |
    awk '/^[[:space:]]*pid = [0-9]+/ { found = 1 } END { exit !found }'; then
    echo "install-launch-agent.sh: updater is running; retry after it finishes" >&2
    exit 1
  fi
done
if [[ "$requested_mode" != auto ]]; then
  mode="$requested_mode"
elif git -C "$RAKESH_REPO_ROOT" remote get-url upstream >/dev/null 2>&1; then
  mode=maintain
else
  mode=follow
fi
h0="$maintainer_hour"
[[ "$mode" == maintain ]] || h0=$((h0 + 1))
sed -e "s#__REPO__#$RAKESH_REPO_ROOT#g" -e "s#__HOME__#$HOME#g" \
  -e "s#__H0__#$h0#g" -e "s#__H1__#$((h0 + 1))#g" \
  "$RAKESH_REPO_ROOT/scripts/rakesh/$label.plist" >"$temporary"
if [[ "$requested_mode" != auto ]]; then
  python3 - "$temporary" "$mode" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as stream:
    data = plistlib.load(stream)
data['EnvironmentVariables'] = {'RAKESH_UPDATE_MODE': sys.argv[2]}
with open(sys.argv[1], 'wb') as stream:
    plistlib.dump(data, stream)
PY
fi
plutil -lint "$temporary" >/dev/null
[[ ! -f "$dest" ]] || cp "$dest" "$previous"

[[ -z "$legacy_label" ]] || launchctl bootout "gui/$(id -u)/$legacy_label" 2>/dev/null || true
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
mv "$temporary" "$dest"
if ! launchctl bootstrap "gui/$(id -u)" "$dest"; then
  rm -f "$dest"
  if [[ -f "$previous" ]]; then
    mv "$previous" "$dest"
    launchctl bootstrap "gui/$(id -u)" "$dest" || true
  elif [[ -n "$legacy_dest" && -f "$legacy_dest" ]]; then
    launchctl bootstrap "gui/$(id -u)" "$legacy_dest" || true
  fi
  echo "install-launch-agent.sh: registration failed; attempted to restore the previous job" >&2
  exit 1
fi
[[ -z "$legacy_dest" ]] || rm -f "$legacy_dest"
echo "install-launch-agent.sh: loaded $label from $dest"
