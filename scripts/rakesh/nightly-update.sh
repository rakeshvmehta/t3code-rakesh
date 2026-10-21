#!/usr/bin/env bash
# Nightly: merge the latest stable upstream release into rakesh/main, build,
# and install "T3 Code (Rakesh)". launchd runs it at 04:00, 04:30, 05:00 and
# 05:30; only the first run of a day merges and builds, later runs retry
# installing a build that was staged because a chat was still working.
#
# Overrides (for testing): RAKESH_NIGHTLY_BRANCH, RAKESH_NIGHTLY_TAG,
# RAKESH_NIGHTLY_INSTALL_TARGET, RAKESH_NIGHTLY_STATE_DIR,
# RAKESH_NIGHTLY_FORCE=1 (ignore today's marker).
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
REPO="$RAKESH_REPO_ROOT"

BRANCH="${RAKESH_NIGHTLY_BRANCH:-rakesh/main}"
TARGET="${RAKESH_NIGHTLY_INSTALL_TARGET:-$RAKESH_INSTALL_PATH}"
STATE_DIR="${RAKESH_NIGHTLY_STATE_DIR:-$HOME/Library/Application Support/t3code-rakesh}"
STAGED_APP="$STATE_DIR/staged/$RAKESH_APP_NAME.app"
STAGED_TAG_FILE="$STATE_DIR/staged/tag"
LOCK_DIR="$STATE_DIR/nightly.lock"
# Build tools dislike spaces in paths, so not under "Application Support".
WORKTREE="$HOME/Library/Caches/t3code-rakesh/nightly-worktree"
TODAY="$(date +%F)"
CLAUDE_BIN="${RAKESH_CLAUDE_BIN:-$HOME/.local/bin/claude}"
STATE_DB="$HOME/.t3/userdata/statev2.sqlite"

mkdir -p "$RAKESH_LOG_DIR" "$STATE_DIR" "$(dirname "$WORKTREE")"
LOG="$RAKESH_LOG_DIR/nightly-$TODAY.log"
exec >>"$LOG" 2>&1

log() { echo "[$(date '+%F %T')] $*"; }

installed_version() {
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TARGET/Contents/Info.plist" 2>/dev/null ||
    echo "unknown"
}

cleanup_worktree() {
  if [[ -e "$WORKTREE" ]]; then
    git -C "$WORKTREE" merge --abort >/dev/null 2>&1 || true
    git -C "$REPO" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || rm -rf "$WORKTREE"
    git -C "$REPO" worktree prune
  fi
}

release_lock() { rm -rf "$LOCK_DIR"; }

fail() {
  log "FAILED: $*"
  cleanup_worktree
  rakesh_notify "T3 Code (Rakesh) update failed — still on $(installed_version). Log: $LOG"
  release_lock
  exit 1
}
trap 'fail "unexpected error at line $LINENO"' ERR

# mkdir is atomic; a lock left by a dead run is reclaimed.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  holder="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$holder" ]] && kill -0 "$holder" 2>/dev/null; then
    log "another nightly run ($holder) holds the lock; exiting"
    trap - ERR
    exit 0
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
echo $$ >"$LOCK_DIR/pid"
trap 'release_lock' EXIT

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
    return 1
  fi
  rm -rf "$STATE_DIR/staged"
  log "installed $tag at $TARGET"
  [[ "$relaunch" == 1 ]] && open "$TARGET"
  rakesh_notify "Updated to $tag"
  return 0
}

log "nightly start (branch $BRANCH, target $TARGET)"

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

if [[ "${RAKESH_NIGHTLY_FORCE:-0}" != 1 && "$(cat "$STATE_DIR/last-run" 2>/dev/null || true)" == "$TODAY" ]]; then
  log "already ran today; nothing staged"
  trap - ERR
  exit 0
fi
git -C "$REPO" fetch upstream --tags --force --quiet

tag="${RAKESH_NIGHTLY_TAG:-}"
if [[ -z "$tag" ]]; then
  # releases/latest is the newest non-draft, non-prerelease release.
  tag="$(gh api repos/pingdotgg/t3code/releases/latest -q .tag_name 2>/dev/null ||
    curl -fsSL https://api.github.com/repos/pingdotgg/t3code/releases/latest |
    /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')"
fi
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "unexpected release tag '$tag'"
git -C "$REPO" rev-parse --verify --quiet "refs/tags/$tag" >/dev/null || fail "tag $tag not fetched"
echo "$TODAY" >"$STATE_DIR/last-run"

if git -C "$REPO" merge-base --is-ancestor "$tag" "$BRANCH"; then
  log "$BRANCH already contains $tag; up to date, nothing to do"
  trap - ERR
  exit 0
fi
log "merging $tag into $BRANCH"

old_head="$(git -C "$REPO" rev-parse "$BRANCH")"
cleanup_worktree
git -C "$REPO" worktree add --detach "$WORKTREE" "$old_head"
cd "$WORKTREE"

if ! git merge --no-ff --no-edit -m "rakesh: merge upstream $tag" "$tag"; then
  conflicted="$(git diff --name-only --diff-filter=U)"
  log "conflicts:"$'\n'"$conflicted"
  [[ -x "$CLAUDE_BIN" ]] || fail "conflicts and no agent at $CLAUDE_BIN"
  result_file="$STATE_DIR/merge-result-$tag.txt"
  rm -f "$result_file"
  prompt_file="$STATE_DIR/merge-prompt.md"
  {
    cat "$REPO/docs/rakesh/MERGE_INSTRUCTIONS.md"
    printf '\nMerging tag: %s into %s. Conflicted files:\n%s\n\nResult file: %s\n' \
      "$tag" "$BRANCH" "$conflicted" "$result_file"
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
    "Bash(pnpm run typecheck)" \
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
  git commit --no-edit
fi
new_head="$(git rev-parse HEAD)"

log "building"
"$WORKTREE/scripts/rakesh/build.sh" || fail "build failed"

mkdir -p "$STATE_DIR/staged"
rm -rf "$STAGED_APP"
ditto "$WORKTREE/release-rakesh/$RAKESH_APP_NAME.app" "$STAGED_APP"
echo "$tag" >"$STAGED_TAG_FILE"

# Fast-forward the branch only after a good build.
if [[ "$(git -C "$REPO" symbolic-ref --quiet --short HEAD || true)" == "$BRANCH" ]]; then
  git -C "$REPO" merge --ff-only --quiet "$new_head" || fail "could not fast-forward $BRANCH (local changes?)"
else
  git -C "$REPO" update-ref "refs/heads/$BRANCH" "$new_head" "$old_head"
fi
log "$BRANCH now at $(git -C "$REPO" rev-parse --short "$BRANCH")"
cd "$REPO"
cleanup_worktree

install_staged || log "install deferred to the next scheduled run"
trap - ERR
exit 0
