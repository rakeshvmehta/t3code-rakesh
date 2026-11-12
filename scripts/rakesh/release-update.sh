#!/usr/bin/env bash
# Shared release updater for T3-R and T3-RN. Two modes:
#   maintain (a checkout with an `upstream` remote): merge the selected
#     upstream release into the channel branch, build, push it to origin
#     (only after a good build), install.
#   follow (a plain clone of the fork): fast-forward to the published branch,
#     build, install. No merge, no agent.
# launchd runs it four times, 30 minutes apart; failed checks/builds retry.
# Each slot discovers newly published releases without rebuilding unchanged apps.
#
# Overrides (for testing): RAKESH_UPDATE_BRANCH, RAKESH_UPDATE_TAG,
# RAKESH_UPDATE_INSTALL_TARGET, RAKESH_UPDATE_STATE_DIR,
# RAKESH_UPDATE_MODE.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
REPO="$RAKESH_REPO_ROOT"

CHANNEL="${RAKESH_UPDATE_CHANNEL:-stable}"
case "$CHANNEL" in
  stable)
    DEFAULT_BRANCH=rakesh/main
    PRODUCT=T3-R
    LOG_PREFIX=stable-update
    STATE_NAME=t3code-rakesh
    BUILD_SCRIPT=build.sh
    BUILD_OUTPUT=release-rakesh
    ;;
  nightly)
    DEFAULT_BRANCH=rakesh/nightly
    PRODUCT=T3-RN
    LOG_PREFIX=t3rn-update
    STATE_NAME=t3code-rakesh-nightly
    BUILD_SCRIPT=build-nightly.sh
    BUILD_OUTPUT=release-rakesh-nightly
    export RAKESH_APP_NAME='T3 Code (Rakesh Nightly)'
    export RAKESH_BUNDLE_ID=com.rakesh.t3code.nightly
    RAKESH_INSTALL_PATH="/Applications/$RAKESH_APP_NAME.app"
    ;;
  *) echo "Unknown release channel: $CHANNEL" >&2; exit 2;;
esac
BRANCH="${RAKESH_UPDATE_BRANCH:-${RAKESH_NIGHTLY_BRANCH:-$DEFAULT_BRANCH}}"
BASE_BRANCH="${RAKESH_UPDATE_BASE_BRANCH:-rakesh/main}"
TARGET="${RAKESH_UPDATE_INSTALL_TARGET:-${RAKESH_NIGHTLY_INSTALL_TARGET:-$RAKESH_INSTALL_PATH}}"
STATE_DIR="${RAKESH_UPDATE_STATE_DIR:-${RAKESH_NIGHTLY_STATE_DIR:-$HOME/Library/Application Support/$STATE_NAME}}"
STAGED_APP="$STATE_DIR/staged/$RAKESH_APP_NAME.app"
STAGED_TAG_FILE="$STATE_DIR/staged/tag"
SUCCESS_FILE="$STATE_DIR/last-success"
LOCK_DIR="$STATE_DIR/nightly.lock" # Shared with older updater entrypoints.
# Build tools dislike spaces in paths, so not under "Application Support".
WORKTREE="${RAKESH_UPDATE_WORKTREE:-$HOME/Library/Caches/t3code-rakesh/$LOG_PREFIX-worktree}"
TODAY="$(date +%F)"
CLAUDE_BIN="${RAKESH_CLAUDE_BIN:-$HOME/.local/bin/claude}"
STATE_DB="$HOME/.t3/userdata/statev2.sqlite"
STAGE="startup"
PREPARING_STAGE=''
CREATED_STAGE=0
if git -C "$REPO" remote get-url upstream >/dev/null 2>&1; then
  MODE="${RAKESH_UPDATE_MODE:-${RAKESH_NIGHTLY_MODE:-maintain}}"
else
  MODE="${RAKESH_UPDATE_MODE:-${RAKESH_NIGHTLY_MODE:-follow}}"
fi
[[ "$MODE" == maintain || "$MODE" == follow ]] || { echo "Unknown updater mode: $MODE" >&2; exit 2; }

# A stalled fetch once hung a run for five hours; give up after two minutes
# under 1 KB/s and let the next scheduled run retry.
export GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=120

mkdir -p "$RAKESH_LOG_DIR" "$STATE_DIR" "$(dirname "$WORKTREE")"
LOG="$RAKESH_LOG_DIR/$LOG_PREFIX-$TODAY.log"
exec >>"$LOG" 2>&1

log() { echo "[$(date '+%F %T')] $*"; }

installed_version() {
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TARGET/Contents/Info.plist" 2>/dev/null ||
    echo "unknown"
}

slack_alert() {
  python3 "$REPO/scripts/rakesh/update-alerts.py" "$1" --state-dir "$STATE_DIR" \
    --product "$PRODUCT" --config "${RAKESH_UPDATE_ALERT_CONFIG:-$HOME/Library/Application Support/t3code-rakesh/slack-alerts.json}" \
    --installed "$(installed_version)" --target "${tag:-unknown}" --stage "$STAGE" --log "$LOG" ||
    log "Slack alert pending; local update status is unchanged"
}

cleanup_worktree() {
  if [[ -e "$WORKTREE" ]]; then
    git -C "$WORKTREE" merge --abort >/dev/null 2>&1 || true
    git -C "$REPO" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || rm -rf "$WORKTREE"
    git -C "$REPO" worktree prune
  fi
}

release_lock() {
  [[ -z "$PREPARING_STAGE" ]] || rm -rf "$PREPARING_STAGE"
  rm -rf "$LOCK_DIR"
}

fail() {
  trap - ERR
  log "FAILED: $*"
  cd "$REPO"
  cleanup_worktree
  [[ "$CREATED_STAGE" == 0 ]] || rm -rf "$STATE_DIR/staged"
  rakesh_notify "$PRODUCT update failed — still on $(installed_version). Log: $LOG"
  slack_alert failure
  release_lock
  exit 1
}
trap 'fail "unexpected error at line $LINENO"' ERR

# mkdir is atomic; a lock left by a dead run is reclaimed.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  holder="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$holder" ]] && kill -0 "$holder" 2>/dev/null; then
    log "another stable-update run ($holder) holds the lock; exiting"
    trap - ERR
    exit 0
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
echo $$ >"$LOCK_DIR/pid"
trap 'release_lock' EXIT

assert_checkout_owner() {
  if [[ "$(git -C "$REPO" symbolic-ref --quiet --short HEAD || true)" != "$BRANCH" ]]; then
    local checkouts
    checkouts="$(git -C "$REPO" worktree list --porcelain)"
    if awk -v branch="refs/heads/$BRANCH" '$1 == "branch" && $2 == branch { found = 1 } END { exit !found }' <<<"$checkouts"; then
      fail "$BRANCH is checked out in another worktree; leaving it unchanged"
    fi
  fi
}
assert_checkout_owner

# Busy = some run is not finished. A failed read counts as busy.
chats_working() {
  [[ -f "$STATE_DB" ]] || return 1
  local active
  active="$(/usr/bin/sqlite3 "file:$STATE_DB?mode=ro" \
    "select count(*) from orchestration_v2_projection_runs
     where status in ('preparing','queued','starting','running','waiting');" 2>/dev/null)" ||
    return 0
  [[ "$active" == "0" ]] && return 1
  log "$active run(s) still active"
  return 0
}

# Installs the staged build. Returns 1 (keeping it staged) when chats are working.
install_staged() {
  STAGE="install"
  local tag
  tag="$(cat "$STAGED_TAG_FILE")"
  local relaunch=0
  if rakesh_app_running && [[ "$TARGET" == "$RAKESH_INSTALL_PATH" ]]; then
    if chats_working; then
      log "app is running with active chats; keeping $tag staged"
      return 1
    fi
    log "quitting $RAKESH_APP_NAME to install $tag"
    osascript -e "tell application id \"$RAKESH_BUNDLE_ID\" to quit" || true
    for _ in $(seq 1 120); do
      rakesh_app_running || break
      sleep 1
    done
    if rakesh_app_running; then
      log "app did not quit; keeping $tag staged"
      return 1
    fi
    relaunch=1
  fi
  mkdir -p "$(dirname "$TARGET")"
  # Callers use `if`/`||`, which disables set -e here, so check explicitly.
  if ! RAKESH_SOURCE_APP="$STAGED_APP" "$REPO/scripts/rakesh/install.sh" "$TARGET"; then
    log "install of $tag failed; keeping it staged"
    slack_alert failure
    return 1
  fi
  rm -rf "$STATE_DIR/staged"
  log "installed $tag at $TARGET"
  if [[ "$relaunch" == 1 ]]; then
    if rakesh_other_app_running; then
      log "another T3 app is running; leaving $PRODUCT closed"
    else
      open "$TARGET"
    fi
  fi
  rakesh_notify "Updated to $tag"
  slack_alert installed
  return 0
}

describe_tag() {
  if [[ "$CHANNEL" == nightly ]]; then
    git -C "$REPO" describe --tags --abbrev=0 --match 'v[0-9]*-nightly.*' "$1"
  else
    git -C "$REPO" describe --tags --abbrev=0 --match 'v[0-9]*' --exclude '*-*' "$1"
  fi
}

# Only the exact commit that passed a build may be published or retried.
publish() {
  [[ "$MODE" == maintain && "$BRANCH" == "$DEFAULT_BRANCH" ]] || return 0
  git -C "$REPO" remote get-url origin >/dev/null 2>&1 || return 0
  [[ -f "$STATE_DIR/publish-ready" ]] || return 0
  local validated_head base_tag
  validated_head="$(sed -n '1p' "$STATE_DIR/publish-ready")"
  base_tag="$(sed -n '2p' "$STATE_DIR/publish-ready")"
  if [[ "$validated_head" != "$(git -C "$REPO" rev-parse "$BRANCH")" ]]; then
    log "source changed since the validated build; not publishing unbuilt commits"
    return 0
  fi
  if git -C "$REPO" push --quiet origin "$validated_head:refs/heads/$BRANCH" "refs/tags/$base_tag"; then
    log "pushed $BRANCH to origin"
    rm -f "$STATE_DIR/publish-ready"
  else
    log "push of $BRANCH to origin failed"
    rakesh_notify "Could not push $BRANCH to GitHub. Log: $LOG"
  fi
}

log "$PRODUCT $CHANNEL updater start ($MODE, branch $BRANCH, target $TARGET)"
slack_alert flush
publish

if [[ -d "$STAGED_APP" ]]; then
  if install_staged; then
    trap - ERR
    exit 0
  fi
  if [[ "$(date +%H%M)" > "0529" && "$(date +%H)" < "12" ]]; then
    rakesh_notify "Update to $(cat "$STAGED_TAG_FILE") is ready; it installs once no chat is working."
  fi
  trap - ERR
  exit 0
fi

# A run missed while the Mac slept fires right on wake, often before Wi-Fi
# is back; give the network ten minutes before fetching.
STAGE="fetch"
for _ in {1..20}; do
  curl -fs -o /dev/null --max-time 10 https://github.com && break
  sleep 30
done

if [[ "$MODE" == follow ]]; then
  git -C "$REPO" fetch --quiet --tags origin "$BRANCH"
  old_head="$(git -C "$REPO" rev-parse "$BRANCH")"
  new_head="$(git -C "$REPO" rev-parse FETCH_HEAD)"
  base_tag="$(describe_tag "$new_head")"
  if [[ "$new_head" == "$old_head" && "$(installed_version)" == "${base_tag#v}" ]]; then
    log "$BRANCH already at origin; up to date, nothing to do"
    trap - ERR
    exit 0
  fi
  git -C "$REPO" merge-base --is-ancestor "$old_head" "$new_head" ||
    fail "local $BRANCH has commits origin does not; not updating"
  tag="$base_tag-$(git -C "$REPO" rev-parse --short "$new_head")"
  log "building origin $BRANCH at $tag"
  cleanup_worktree
  git -C "$REPO" worktree add --detach "$WORKTREE" "$new_head"
  cd "$WORKTREE"
else
tag="${RAKESH_UPDATE_TAG:-${RAKESH_NIGHTLY_TAG:-}}"
if [[ -z "$tag" ]]; then
  if [[ "$CHANNEL" == nightly ]]; then
    STAGE="release discovery"
    if releases="$(gh api 'repos/pingdotgg/t3code/releases?per_page=100' 2>/dev/null)" &&
       tag="$(printf '%s' "$releases" | python3 "$REPO/scripts/rakesh/select-release.py" nightly)"; then
      :
    else
      log "GitHub CLI release lookup failed; retrying with a fresh HTTPS response"
      tag="$(curl -fsSL --connect-timeout 15 --max-time 120 \
        'https://api.github.com/repos/pingdotgg/t3code/releases?per_page=100' |
        python3 "$REPO/scripts/rakesh/select-release.py" nightly)"
    fi
    unset releases
  else
    tag="$(gh api repos/pingdotgg/t3code/releases/latest -q .tag_name 2>/dev/null ||
      curl -fsSL https://api.github.com/repos/pingdotgg/t3code/releases/latest |
      /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')"
  fi
fi
if [[ "$CHANNEL" == nightly ]]; then
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]{8}\.[0-9]+$ ]] || fail "unexpected nightly tag '$tag'"
  git -C "$REPO" rev-parse --verify "$BASE_BRANCH" >/dev/null || fail "nightly requires local stable branch $BASE_BRANCH"
else
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "unexpected release tag '$tag'"
fi
base_tag="$tag"
log "fetching $CHANNEL release $tag"
git -C "$REPO" fetch --quiet --no-tags upstream "refs/tags/$tag:refs/tags/$tag"
git -C "$REPO" rev-parse --verify --quiet "refs/tags/$tag" >/dev/null || fail "tag $tag not fetched"

if git -C "$REPO" merge-base --is-ancestor "$tag" "$BRANCH" &&
   { [[ "$CHANNEL" == stable ]] || git -C "$REPO" merge-base --is-ancestor "$BASE_BRANCH" "$BRANCH"; } &&
   [[ "$(installed_version)" == "${tag#v}" ]]; then
  log "$BRANCH already contains $tag; up to date, nothing to do"
  echo "$TODAY" >"$SUCCESS_FILE"
  trap - ERR
  exit 0
fi
log "merging $tag into $BRANCH"
STAGE="merge"

old_head="$(git -C "$REPO" rev-parse "$BRANCH")"
cleanup_worktree
git -C "$REPO" worktree add --detach "$WORKTREE" "$old_head"
cd "$WORKTREE"

merge_release_ref() {
  local source_ref="$1"
  if ! git merge --no-ff --no-edit -m "rakesh: merge $source_ref into $PRODUCT" "$source_ref"; then
    conflicted="$(git diff --name-only --diff-filter=U)"
    log "conflicts:"$'\n'"$conflicted"
    [[ -x "$CLAUDE_BIN" ]] || fail "conflicts and no agent at $CLAUDE_BIN"
    result_file="$STATE_DIR/merge-result-$tag.txt"
    rm -f "$result_file"
    prompt_file="$STATE_DIR/merge-prompt.md"
    {
      cat "$REPO/docs/rakesh/MERGE_INSTRUCTIONS.md"
      printf '\nMerging ref: %s into %s (%s channel). Expected app: %s / %s. Conflicted files:\n%s\n\nResult file: %s\n' \
        "$source_ref" "$BRANCH" "$CHANNEL" "$RAKESH_APP_NAME" "$RAKESH_BUNDLE_ID" "$conflicted" "$result_file"
    } >"$prompt_file"
    log "running merge agent"
    # The prompt goes in on stdin: the variadic tool flags would swallow it as
    # an argument. Bash is limited to read-only git, `git add`/`checkout` and the
    # exact test commands in the brief, so the agent cannot commit, push or reset.
    "$CLAUDE_BIN" -p --permission-mode acceptEdits --add-dir "$STATE_DIR" \
      --allowedTools "Read" "Edit" "Write" "Glob" "Grep" "Bash(git status:*)" "Bash(git diff:*)" \
      "Bash(git log:*)" "Bash(git show:*)" "Bash(git add:*)" "Bash(git checkout:*)" \
      "Bash(git ls-files:*)" "Bash(git rev-parse:*)" "Bash(cd:*)" "Bash(ls:*)" \
      "Bash(pnpm install --frozen-lockfile)" "Bash(pnpm exec vp test run:*)" \
      "Bash(pnpm exec vp run typecheck)" \
      --disallowedTools "Bash(git push:*)" "Bash(git commit:*)" "Bash(git merge:*)" \
      "Bash(git reset:*)" "Bash(git rebase:*)" "Bash(pnpm exec git:*)" "Bash(pnpm dlx:*)" \
      <"$prompt_file" &
    agent_pid=$!
    # A 90 minute ceiling for the agent.
    (sleep 5400 && kill -TERM "$agent_pid" 2>/dev/null) &
    watchdog=$!
    wait "$agent_pid" || log "merge agent exited non-zero"
    kill "$watchdog" 2>/dev/null || true
    verdict="$(head -n 1 "$result_file" 2>/dev/null || echo "ABORT: no result written")"
    log "merge agent: $verdict"
    [[ "$verdict" == RESOLVED:* ]] || fail "merge not resolved ($verdict)"
    [[ -z "$(git diff --name-only --diff-filter=U)" ]] || fail "agent left unresolved files"
    if git grep -nE '^(<<<<<<<|>>>>>>>)( |$)' -- . >/dev/null; then
      fail "conflict markers remain"
    fi
    STAGE="validation"
    git commit --no-edit
  fi
}
if [[ "$CHANNEL" == nightly ]]; then
  merge_release_ref "$BASE_BRANCH"
fi
merge_release_ref "$tag"
fi
new_head="$(git rev-parse HEAD)"

log "building"
STAGE="build"
RAKESH_BUILD_TAG="$base_tag" /bin/bash "$WORKTREE/scripts/rakesh/$BUILD_SCRIPT" || fail "build failed"

if [[ "$MODE" == maintain ]]; then
  printf '%s\n%s\n' "$new_head" "$base_tag" >"$STATE_DIR/publish-ready.new"
  mv "$STATE_DIR/publish-ready.new" "$STATE_DIR/publish-ready"
fi

STAGE="staging"
[[ ! -e "$STATE_DIR/staged" ]] || fail "unexpected staged directory; preserving it"
PREPARING_STAGE="$(mktemp -d "$STATE_DIR/staged.preparing.XXXXXX")"
ditto "$WORKTREE/$BUILD_OUTPUT/$RAKESH_APP_NAME.app" "$PREPARING_STAGE/$RAKESH_APP_NAME.app"
echo "$tag" >"$PREPARING_STAGE/tag"
mv "$PREPARING_STAGE" "$STATE_DIR/staged"
PREPARING_STAGE=''
CREATED_STAGE=1

# Fast-forward the branch only after a good build.
assert_checkout_owner
if [[ "$(git -C "$REPO" symbolic-ref --quiet --short HEAD || true)" == "$BRANCH" ]]; then
  git -C "$REPO" merge --ff-only --quiet "$new_head" || fail "could not fast-forward $BRANCH (local changes?)"
else
  git -C "$REPO" update-ref "refs/heads/$BRANCH" "$new_head" "$old_head"
fi
CREATED_STAGE=0
log "$BRANCH now at $(git -C "$REPO" rev-parse --short "$BRANCH")"
STAGE="publish"
publish
cd "$REPO"
cleanup_worktree
echo "$TODAY" >"$SUCCESS_FILE"

install_staged || log "install deferred to the next scheduled run"
trap - ERR
exit 0
