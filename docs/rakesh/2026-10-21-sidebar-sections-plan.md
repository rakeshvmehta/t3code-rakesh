# Sidebar Sections (Rakesh build) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a personal T3 Code desktop build, "T3 Code (Rakesh)", that adds Codex-style custom sidebar sections, installs next to the official app, and rebuilds itself every night from the latest upstream stable release.

**Architecture:** This is a frontend-only feature in `apps/web`, with no server, contract or database changes. Section definitions, which chat belongs to which section, and collapse state are stored in browser `localStorage` through the existing `useLocalStorage` hook. Custom sections render as new marker rows inside the existing "active" shelf of the flat sidebar list. Drag and drop keeps using the existing dnd-kit pipeline, and the section a chat is dropped into is decided by the nearest custom-section marker above the drop slot. Packaging changes only the app identity (name and bundle id) and turns off the auto-updater. A launchd job runs `scripts/rakesh/nightly-update.sh` at 04:00.

**Tech Stack:** TypeScript, React 19, @dnd-kit, Effect Schema, vite-plus (`vp test`), Electron, pnpm 11, Node 24, launchd.

**Spec:** The scope approved in chat on 2026-10-21, restated in "Behavior spec" below.

## Behavior spec (approved)

- A new **"New section"** button uses the lucide `ListPlusIcon`. It sits in the sidebar header between the filter control and the new-project (`FolderPlusIcon`) button, with the tooltip "New section".
- Clicking it adds a new section header at the **end of the custom sections**, in the active area. The name input is focused. Enter saves, and Esc (or an empty name) cancels.
- Chats are dragged into, out of and between sections. A section never changes a chat's project.
- One section can hold chats from different projects.
- **Order:** Pinned → custom sections (user order) → **"Chats"** (the default bucket for chats with no section) → Working / Snoozed shelves (upstream, unchanged) → Settled.
- Custom sections and "Chats" collapse and expand like the Settled shelf. A collapsed section shows its chat count. The route (open) thread stays visible in a collapsed section, matching the `routeThreadOnly` behaviour.
- **Pinned wins:** a pinned chat shows only in Pinned. Unpinning returns it to its remembered section.
- **Settled wins:** a settled chat shows only in Settled. Unsettling returns it to its remembered section. The same goes for snoozed and working chats.
- New chats start in "Chats".
- The section header context menu has **Rename, Move up, Move down, Delete**. Deleting a section moves its chats to "Chats".
- Sections are stored on this Mac only and don't sync.
- Everything else behaves as upstream does: badges, project chips, pin, snooze, settle, archive, search and keyboard navigation.

## Global Constraints

- Upstream remote is `upstream` (`https://github.com/pingdotgg/t3code.git`). Our branch is `rakesh/main`, which tracks the **latest non-prerelease GitHub release tag** (currently `v0.1.1`). Never track nightly or preview tags.
- Node `^24.13.1` (from the repo `engines` field) and pnpm `11.10.0`. Install Node 24 with Homebrew `node@24` and use it through a PATH prefix in the build scripts. Do not change the user's default `node`, which is 26.
- No edits to `apps/server`, `packages/contracts`, persistence or migrations. The official app shares `~/.t3/userdata`.
- Keep edits to `apps/web/src/components/Sidebar.tsx` small, and put logic in new files under `apps/web/src/components/sidebarSections/`. Upstream changes that file roughly every day.
- localStorage key: `t3code:rakesh:sidebar-sections:v1`. Section ids are `crypto.randomUUID()`.
- App identity: productName `T3 Code (Rakesh)`, bundle id `com.rakesh.t3code`. The installed path is `/Applications/T3 Code (Rakesh).app`. Auto-update must be fully disabled in this build.
- Every commit that is ours is prefixed `rakesh:` so the nightly merge can identify our patch set.

## Review Focus

1. **A chat in a collapsed section is dragged and dropped elsewhere.** The global active order must keep the hidden chats. Drop-target ordering is computed on the full list, including rows hidden by collapse.
2. **Time-ordered active list** (`sidebarWorkingShelfEnabled = true`): moving a chat into another section must still work even though upstream treats in-active moves as `kind: "none"`. The section assignment must apply, and collision detection must accept that target.
3. **Stale assignments:** a stored assignment can point to a deleted section or a vanished chat. The chat falls back to "Chats", nothing crashes, and dead keys are pruned lazily.
4. **Drop onto a section header** (collapsed or empty section): the chat joins that section, not the previous one.
5. **localStorage is missing or corrupt** (bad JSON or the wrong shape): the store resets to empty and the sidebar renders exactly like upstream.

---

### Task 1: Toolchain and baseline build

**Files:** none (environment only)

- [ ] `brew install node@24`, then use `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"` in every build shell. Run `corepack enable` and `pnpm -v` and expect `11.10.0`.
- [ ] `pnpm install` at the repo root succeeds.
- [ ] Baseline tests pass: `pnpm exec vp test run apps/web/src/components/Sidebar.logic.test.ts apps/web/src/components/Sidebar.drag.test.ts`.
- [ ] A baseline unsigned macOS arm64 desktop artifact builds through `node scripts/build-desktop-artifact.ts` with `T3CODE_DESKTOP_SIGNED=false` (or the script's unsigned equivalent; read `scripts/build-desktop-artifact.ts` for the actual flags). Record the exact working command in `scripts/rakesh/build.sh`, which later tasks extend. Also find and record where the packaged app reads `T3CODE_HOME` and its default `~/.t3/userdata`, and which Electron `userData` dir it resolves to (`DesktopUserData.resolveUserDataPath`; the official build uses `~/Library/Application Support/t3code-v2`).

### Task 2: Section store (pure model + hook)

**Files:**
- Create: `apps/web/src/components/sidebarSections/sidebarSections.logic.ts`
- Create: `apps/web/src/components/sidebarSections/useSidebarSections.ts`
- Test: `apps/web/src/components/sidebarSections/sidebarSections.logic.test.ts`

**Interfaces (produces):**
```ts
export const SIDEBAR_SECTIONS_STORAGE_KEY = "t3code:rakesh:sidebar-sections:v1";
export type SidebarCustomSection = { readonly id: string; readonly name: string; readonly collapsed: boolean };
export type SidebarSectionsState = {
  readonly sections: readonly SidebarCustomSection[];          // display order
  readonly assignments: Readonly<Record<string, string>>;     // threadKey -> sectionId
  readonly chatsCollapsed: boolean;
};
export const EMPTY_SIDEBAR_SECTIONS_STATE: SidebarSectionsState;
export const SidebarSectionsStateSchema; // Effect Schema used with useLocalStorage
export function addSection(s, id: string, name: string): SidebarSectionsState;
export function renameSection(s, id: string, name: string): SidebarSectionsState;
export function deleteSection(s, id: string): SidebarSectionsState;      // drops its assignments
export function moveSection(s, id: string, delta: -1 | 1): SidebarSectionsState;
export function toggleSectionCollapsed(s, id: string | "chats"): SidebarSectionsState;
export function assignThread(s, threadKey: string, sectionId: string | null): SidebarSectionsState; // null = Chats
export function sectionIdForThread(s, threadKey: string): string | null; // null if unknown section
export type ActiveSectionGroup = { readonly sectionId: string | null; readonly name: string; readonly collapsed: boolean; readonly threadKeys: readonly string[] };
export function groupActiveThreadKeys(s, orderedActiveKeys: readonly string[]): readonly ActiveSectionGroup[]; // custom sections in order (including empty ones), then Chats (sectionId null, name "Chats"); preserves input order within a group
export function useSidebarSections(): { state; add(name): string; rename; remove; move; toggle; assign };
```

- [ ] Write tests for these cases:
  - `groupActiveThreadKeys` preserves order and puts unassigned and dangling-section keys in Chats.
  - Empty sections appear.
  - `deleteSection` moves its chats to Chats.
  - `moveSection` clamps at the ends.
  - A trimmed empty name in `addSection`/`renameSection` is a no-op.
  - Decoding a corrupt value with the schema falls back to `EMPTY_SIDEBAR_SECTIONS_STATE` (Review Focus 3 and 5).
- [ ] Run the tests and see them fail. Implement. Run them again and see them pass.
- [ ] `useSidebarSections` wraps `useLocalStorage(SIDEBAR_SECTIONS_STORAGE_KEY, EMPTY_SIDEBAR_SECTIONS_STATE, SidebarSectionsStateSchema)`.
- [ ] Commit `rakesh: sidebar sections store`.

### Task 3: List markers and drop resolution

**Files:**
- Modify: `apps/web/src/components/Sidebar.logic.ts`. The only change is to extend `SidebarListMarker` with `` `custom-section:${string}` `` and `"chats-header"`.
- Create: `apps/web/src/components/sidebarSections/sidebarSections.list.ts`
- Test: `apps/web/src/components/sidebarSections/sidebarSections.list.test.ts`

**Interfaces (produces):**
```ts
export function customSectionMarker(sectionId: string): SidebarListMarker; // `custom-section:${id}`
export function parseCustomSectionMarker(marker: SidebarListMarker): string | null;
// Builds the active-area rows: for each group, its header marker, then its rows (all rows if expanded, else only routeThreadKey's row).
export function buildActiveSectionItems(groups: readonly ActiveSectionGroup[], routeThreadKey: string | null, mode: "visible" | "full"): SidebarListItem[];
// The section (id, or null = Chats) owning list slot `index` once `activeKey` is moved onto `overId`. Same arrayMove semantics as resolveSidebarDropTarget. A drop onto a custom-section/chats header joins THAT header's section.
export function resolveDropSectionId(items: readonly SidebarListItem[], activeKey: string, overId: string): string | null | undefined; // undefined = not in active area
```
The new markers sit between `active-placeholder` and the working/snoozed/settled headers. Existing `sectionAtSidebarSlot` already treats unknown markers as staying in "active", which is what we want. Check that `Sidebar.drag.ts` (`isShelfHeader`, the sorting strategy) and `Sidebar.motion.ts` tolerate the new markers, and add them to any exhaustive switch.

- [ ] Write tests for:
  - item order across two sections plus Chats
  - a collapsed section emits only its header (plus the route row)
  - `mode: "full"` emits every row
  - `resolveDropSectionId` returns the right id for drops on rows, on a section header (Review Focus 4) and on the Chats header
  - the result is `undefined` for pinned and settled slots
  - `resolveSidebarDropTarget(fullItems, …)` keeps hidden rows in `activeOrder` (Review Focus 1)
- [ ] Fail → implement → pass. Also run `Sidebar.logic.test.ts` and `Sidebar.drag.test.ts` unchanged and confirm they still pass.
- [ ] Commit `rakesh: sidebar section list markers`.

### Task 4: Sidebar integration (UI)

**Files:**
- Create: `apps/web/src/components/sidebarSections/SidebarSectionHeader.tsx` (a collapsible header row that matches the Settled shelf header's look, with a count and a context menu: Rename / Move up / Move down / Delete, plus inline rename input)
- Create: `apps/web/src/components/sidebarSections/NewSectionButton.tsx` (`SidebarHeaderIconButton` with `ListPlusIcon`, tooltip "New section")
- Modify: `apps/web/src/components/sidebar/SidebarThreadHeader.tsx` (render `NewSectionButton` before the new-project button, behind an optional `onNewSection` prop)
- Modify: `apps/web/src/components/Sidebar.tsx`, minimal hooks only:
  1. Call `useSidebarSections()` in the component that builds `sidebarListItemsFresh`.
  2. Replace `items.push(...activeRows)` with `buildActiveSectionItems(groupActiveThreadKeys(state, activeKeys), routeRowThreadKey, "visible")`. Keep a parallel `fullItems` built with `"full"`.
  3. In the three `resolveSidebarDropTarget(...)` call sites, pass `fullItems`.
  4. In `handleThreadDragEnd`, compute `dropSectionId = resolveDropSectionId(fullItems, activeKey, overId)` **before** the `plan.kind === "none"` early return. If it is not `undefined` and differs from the current assignment, call `assign(activeKey, dropSectionId)`. Then continue with the upstream plan (unpin, unsettle, wake and reorder still happen through upstream code).
  5. In collision validity, accept a target when the upstream plan is not `"none"` **or** when `resolveDropSectionId` gives a different section (Review Focus 2).
  6. Render the new markers in the marker `switch` (`SidebarSectionHeader` for `custom-section:*` and `chats-header`). Hide the Chats header only when there are no custom sections, so the sidebar looks exactly like upstream until the first section exists.
  7. Pass `onNewSection` to `SidebarThreadHeader`. It creates the section via `add()` and puts that header into rename mode.
- [ ] Unit-test any new pure helpers. Run `pnpm exec vp test run apps/web/src/components` and expect everything green.
- [ ] Typecheck: `pnpm --filter @t3tools/web typecheck` (or the repo's `vp` typecheck for web). Lint: `pnpm lint`.
- [ ] Manual check in `pnpm dev:web` or `dev:desktop` with a throwaway `T3CODE_HOME` (never the real `~/.t3` during dev):
  - create, rename, reorder and delete sections
  - drag a chat into a section, then pin and unpin it and confirm it returns to the section
  - settle and unsettle it and confirm it returns
  - collapse and expand sections and Chats
  - reload and confirm the state persists
  - drop onto a collapsed header
- [ ] Commit `rakesh: sidebar sections UI`.

### Task 5: App identity, updater off, install

**Files:**
- Modify the minimal set of `apps/desktop/package.json` (`productName`), `scripts/build-desktop-artifact.ts` (`DESKTOP_APP_ID`, product-name resolution) and the desktop updater wiring, so that this build never checks for or applies updates. Prefer an env or flag the code already supports; otherwise make a one-line change at the updater's entry point.
- Create: `scripts/rakesh/build.sh` (Node 24 PATH, `pnpm install --frozen-lockfile`, tests from Tasks 2–3, unsigned arm64 artifact into `release-rakesh/`)
- Create: `scripts/rakesh/install.sh`:
  1. Refuse to run if `T3 Code (Rakesh)` is running. The official app may stay open, because the user runs it during the initial build.
  2. Copy the built `.app` to `/Applications/T3 Code (Rakesh).app` atomically: copy to `.new`, rename the old copy to `.prev`, then rename `.new` into place.
  3. `xattr -dr com.apple.quarantine`.
  4. Keep `.prev` for rollback.

Steps:
- [ ] Build and install.
- [ ] Verify the packaged app's state dir is `~/.t3/userdata` (the same chats appear) and record which Electron `userData` dir it uses. If it differs from the official one, copy the official `Local Storage` dir into it once, before first launch, so client settings carry over.
- [ ] **The official T3 Code app is running the user's live session during this build, so never quit it.** Do not point the Rakesh build at the real `~/.t3` while the official app runs. Verify against a snapshot: copy `~/.t3/userdata` (DB and state only, not worktrees) to a temp `T3CODE_HOME`, and use a separate Electron `userData` if the profile lock would collide. The user makes the real switch: quit the official app, then open `T3 Code (Rakesh)`.
- [ ] Launch the app on the snapshot and verify:
  - all projects and threads are listed
  - the List Plus button is present
  - sections work end to end
  - no update prompt appears
  - Settings → About shows the expected version
- [ ] Commit `rakesh: app identity, updater disabled, build/install scripts`.

### Task 6: Nightly upstream update (04:00)

**Files:**
- Create: `scripts/rakesh/nightly-update.sh`
- Create: `docs/rakesh/MERGE_INSTRUCTIONS.md` (the conflict-resolution brief)
- Create: `scripts/rakesh/com.rakesh.t3code.nightly.plist`, installed to `~/Library/LaunchAgents/` and loaded with `launchctl bootstrap gui/$UID`

Flow:
1. Take a lock.
2. Run `git fetch upstream --tags`.
3. Find the latest **non-prerelease** release via `gh release list -R pingdotgg/t3code --exclude-pre-releases --limit 1`.
4. If that tag is already merged into `rakesh/main`, log it and exit.
5. In a temporary worktree, run `git merge --no-ff <tag>`.
6. On conflict, run a headless agent with `docs/rakesh/MERGE_INSTRUCTIONS.md` as the brief, for example `claude -p --permission-mode acceptEdits "$(cat docs/rakesh/MERGE_INSTRUCTIONS.md)"` (check which CLI and flags are installed). It resolves the conflicts so that upstream changes are kept and our behavior is preserved, then runs the tests.
7. Run `scripts/rakesh/build.sh`.
8. On success, fast-forward `rakesh/main`.
9. If the app is not running, install now. If it is running and no thread is working (check how the backend exposes run status, for example the `t3` CLI or a read-only query of the state DB), quit it gracefully, install, and relaunch. Otherwise stage the build and retry the install at 04:30, 05:00 and 05:30.
10. On any failure, leave `/Applications` untouched, write the log to `~/Library/Logs/t3code-rakesh/nightly-YYYY-MM-DD.log`, and post a macOS notification ("T3 Code (Rakesh) update failed — still on <version>") with `osascript`.
11. On success, post a short notification ("Updated to <tag>").

`MERGE_INSTRUCTIONS.md` must state:
- Our patch set is the `rakesh:`-prefixed commits.
- The behavior spec above is the contract.
- Upstream wins on everything else.
- Re-run the tests from Tasks 2–4.
- If the feature can't be preserved with confidence, abort the merge instead of guessing.

- [ ] Dry-run the script against the current tag and expect "up to date, nothing to do".
- [ ] Simulate an update by resetting a scratch branch to the previous stable tag, merging forward, building, and installing to a temp path rather than `/Applications`. The pipeline must succeed end to end.
- [ ] Load the LaunchAgent and confirm with `launchctl print gui/$UID/com.rakesh.t3code.nightly` that it is scheduled for 04:00.
- [ ] Commit `rakesh: nightly upstream update`.
