#!/usr/bin/env bash
# Installs a channel job or a shared morning window with stable before nightly.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

channel="${1:-stable}"
if [[ $# == 0 && -f "$HOME/Library/LaunchAgents/com.rakesh.t3code.release-update.plist" ]]; then
  channel=both
fi
requested_mode="${2:-auto}"
retired_labels=()
case "$channel" in
  stable) label=com.rakesh.t3code.stable-update; retired_labels=(com.rakesh.t3code.nightly); maintainer_hour=4;;
  nightly) label=com.rakesh.t3code.t3rn-update; maintainer_hour=2;;
  both)
    label=com.rakesh.t3code.release-update
    retired_labels=(com.rakesh.t3code.stable-update com.rakesh.t3code.t3rn-update com.rakesh.t3code.nightly)
    maintainer_hour=4
    ;;
  *) echo 'Expected stable, nightly or both' >&2; exit 2;;
esac
case "$requested_mode" in
  auto|maintain|follow) ;;
  *) echo 'Expected auto, maintain, or follow mode' >&2; exit 2;;
esac
dest="$HOME/Library/LaunchAgents/$label.plist"
if [[ "$channel" == both && "$requested_mode" == auto && -f "$dest" ]]; then
  requested_mode="$(python3 - "$dest" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as stream:
    role = plistlib.load(stream).get('EnvironmentVariables', {}).get('RAKESH_UPDATE_MODE')
print(role if role in ('maintain', 'follow') else 'auto')
PY
)"
fi
if [[ "$channel" != both && -f "$HOME/Library/LaunchAgents/com.rakesh.t3code.release-update.plist" ]]; then
  echo 'install-launch-agent.sh: a combined job is installed; use both to update it' >&2
  exit 1
fi
temporary="$dest.new.$$"
previous="$dest.previous.$$"
mkdir -p "$HOME/Library/LaunchAgents" "$RAKESH_LOG_DIR"
trap 'rm -f "$temporary" "$previous"' EXIT
loaded_jobs=()
for job in "$label" ${retired_labels[@]+"${retired_labels[@]}"}; do
  if job_state="$(launchctl print "gui/$(id -u)/$job" 2>/dev/null)"; then
    loaded_jobs+=("$job")
    if awk '/^[[:space:]]*pid = [0-9]+/ { found = 1 } END { exit !found }' <<<"$job_state"; then
      echo "install-launch-agent.sh: updater is running; retry after it finishes" >&2
      exit 1
    fi
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

restore_jobs() {
  if [[ -f "$previous" ]]; then
    cp "$previous" "$dest"
  else
    rm -f "$dest"
  fi
  local old_job old_path
  for old_job in ${loaded_jobs[@]+"${loaded_jobs[@]}"}; do
    old_path="$HOME/Library/LaunchAgents/$old_job.plist"
    [[ ! -f "$old_path" ]] || launchctl bootstrap "gui/$(id -u)" "$old_path" || true
  done
}

for job in ${loaded_jobs[@]+"${loaded_jobs[@]}"}; do
  if ! launchctl bootout "gui/$(id -u)/$job"; then
    restore_jobs
    echo "install-launch-agent.sh: could not unload $job; previous jobs retained" >&2
    exit 1
  fi
done
mv "$temporary" "$dest"
if ! launchctl bootstrap "gui/$(id -u)" "$dest"; then
  restore_jobs
  echo "install-launch-agent.sh: registration failed; attempted to restore the previous job" >&2
  exit 1
fi
for job in ${retired_labels[@]+"${retired_labels[@]}"}; do
  rm -f "$HOME/Library/LaunchAgents/$job.plist"
done
echo "install-launch-agent.sh: loaded $label from $dest"
