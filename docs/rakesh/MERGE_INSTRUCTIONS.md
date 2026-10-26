# Merge brief: upstream release into `rakesh/main`

You are resolving a `git merge` of an upstream T3 Code release tag into this
personal fork. The merge is already in progress in your current directory and
has conflicts. Nobody is watching; work carefully and stop rather than guess.

## What is ours

Our patch set is every non-merge commit whose subject starts with `rakesh:`:

```sh
git log --no-merges --grep '^rakesh:' --format='%h %s' MERGE_HEAD..HEAD
```

Read those commits (`git show <sha>`) before touching a conflict. Our code
lives mostly in new files, and those almost never conflict:

- `apps/web/src/components/sidebarSections/**` (the feature)
- `apps/web/src/components/rakesh/**` (the "T3-R" sidebar brand mark, thread notes)
- `scripts/rakesh/**`, `docs/rakesh/**` (build, install, nightly, this file)

Our edits to upstream files are deliberately small:

- `apps/web/src/components/Sidebar.tsx`: `useSidebarSectionsController(...)`
  after `useSidebarThreads(...)`; `orderedThreadKeys` routed through
  `sectionsController.orderThreadKeys`; the active rows come from
  `sectionsController.activeItems(mode)` inside `buildSidebarListItems`;
  `sidebarListItemsFull`; the three `resolveSidebarDropTarget` calls use
  `sidebarListItemsFull`; `trackDragOver`, `changesSection`, `applyDrop`,
  `activeOrder: sectionsController.activeOrder`, and both
  `planSidebarThreadDrop` calls take
  `target: sectionsController.planTarget(sidebarListItemsFull, target, key, overId)`; the `default:` marker branch
  rendering `sectionsController.renderHeader` inside `SortableSidebarMarker`;
  the Active placeholder hint is hidden when custom sections exist;
  `onNewSection` on `SidebarThreadHeader`; pinned rows filtered through
  `sectionsController.showsPinnedRow(key, mode)` in `buildSidebarListItems`;
  the `pinned-header` case pushes `sectionsController.renderPinnedHeader(...)`
  before the `SidebarDragBoundary`, whose label shows only when nothing is pinned.
- `apps/web/src/components/Sidebar.tsx`, thread notes:
  `const threadNotes = useThreadNotesController()` after the sections
  controller; the single-thread menu calls
  `threadNotes.showMenu(api.contextMenu, threadKey, buildThreadActionMenuItems(...), position)`
  instead of `api.contextMenu.show(...)`; right after the
  `clicked.value === null` return, `isThreadNoteMenuId(clicked.value)` hands
  the click to `threadNotes.handleMenu` and returns; both delete paths call
  `threadNotes.forget(...)` (bulk: `deletedThreadKeys`; single: after a
  successful delete); `{threadNotes.dialog}` after `<SidebarChromeFooter />`.
- `apps/web/src/components/sidebar/SidebarThreadRow.tsx`:
  `<ThreadNoteHoverLine threadKey=... />` is the first child of
  `ThreadHoverCard` in `SidebarThreadTooltip`.
- `apps/web/src/components/Sidebar.logic.ts`: two extra `SidebarListMarker`
  members, `` `custom-section:${string}` `` and `"chats-header"`.
- `apps/web/src/components/Sidebar.drag.ts`: the sorting strategy uses
  `projectSectionedActiveArea` for the active area; collision detection prefers
  a section header under the pointer at its drawn position.
- `apps/web/src/components/sidebar/SidebarListMarkers.tsx`:
  `SortableSidebarMarker` is exported (upstream keeps it file-private) so
  `Sidebar.tsx` can wrap our section headers in it.
- `apps/web/src/components/sidebar/SidebarThreadHeader.tsx`: optional
  `onNewSection` prop rendering `NewSectionButton` between the project filter
  and the Add project button.
- `scripts/build-desktop-artifact.ts`: `resolveDesktopAppId()` and the
  `T3CODE_DESKTOP_PRODUCT_NAME` override in `resolveDesktopProductName`.
- `.gitignore`: `release-rakesh/`.
- `apps/web/src/components/sidebar/SidebarChrome.tsx`: `SidebarBrandMark` just
  returns `<RakeshBrandMark onBackdrop={onBackdrop} />`. On conflict keep that
  body and take upstream's changes elsewhere in the file.
- `assets/prod/t3-black-web-apple-touch-180.png`, `t3-black-web-favicon.ico`,
  `t3-black-web-favicon-16x16.png`, `t3-black-web-favicon-32x32.png`: the T3-R
  icon. The desktop build copies these over the web icons, and the splash
  screen shows the apple-touch one. On conflict keep ours.

## The contract (must still hold after the merge)

- A "New section" button (lucide `ListPlusIcon`, tooltip "New section") sits
  in the sidebar header between the filter control and the new-project button.
- Clicking it adds a section at the end of the custom sections with its name
  input focused. Enter saves; Esc or an empty name cancels.
- Chats are dragged into, out of and between sections. A section never changes
  a chat's project, and one section can hold chats from several projects.
- Order: Pinned, custom sections (user order), "Chats" (chats with no
  section), then upstream's Working / Snoozed shelves, then Settled.
- Custom sections and "Chats" collapse like the Settled shelf; collapsed shows
  a count; the open (route) chat stays visible in a collapsed section.
- Pinned wins and Settled wins (also snoozed and working): such a chat shows
  only in that shelf and returns to its remembered section afterwards.
- New chats start in "Chats". Header context menu: Rename, Move up, Move down,
  Delete. Deleting a section moves its chats to "Chats".
- Sections live in localStorage (`t3code:rakesh:sidebar-sections:v1`) on this
  Mac only.
- "Chats" always shows its collapsible header, even with no custom sections.
- Pinned shows a collapsible "Pinned" header (count when collapsed) whenever
  there are pinned chats; collapsed, only the open chat stays visible.
- A single thread's right-click menu has "Add note…" (or "Edit note…" and
  "Clear note") right after "Rename thread". The note shows at the top of the
  thread's hover card; nothing else about the row changes. Notes live in
  localStorage (`t3code:rakesh:thread-notes:v1`).
- Everything else (badges, project chips, pin, snooze, settle, archive,
  search, keyboard navigation) behaves exactly as upstream.
- The app builds as "T3 Code (Rakesh)" / `com.rakesh.t3code` with no update
  feed.

## How to resolve

1. Upstream wins on everything that is not ours. When upstream rewrote code we
   hook into, take upstream's version and re-apply our small hook to the new
   code. Never revert, drop or "simplify" upstream changes.
2. Keep our hooks minimal. Put any new logic in `sidebarSections/` or
   `rakesh/`, not in `Sidebar.tsx`.
3. Never edit `apps/server`, `packages/contracts`, persistence or migrations.
4. Resolve every conflicted file, remove all conflict markers, and `git add`
   them. Do not commit, do not push, do not abort the merge yourself; the
   nightly script does that from your result.
5. Run our tests and make them pass:

   ```sh
   pnpm install --frozen-lockfile
   pnpm exec vp test run apps/web/src/components/sidebarSections/ \
     apps/web/src/components/rakesh/ \
     apps/web/src/components/Sidebar.logic.test.ts \
     apps/web/src/components/Sidebar.drag.test.ts
   (cd apps/web && pnpm exec vp test run --project browser src/components/Sidebar)
   (cd scripts && pnpm exec vp test run --config ../vite.config.ts --dir . rakesh/identity.test.ts)
   (cd apps/web && pnpm exec vp run typecheck)
   ```

   If upstream changed an API a test of ours relies on, update our test or
   code to the new API while keeping the contract. Do not delete or skip
   tests to get green.

## When to stop

Abort instead of guessing if any of these is true:

- You cannot tell how to keep both upstream's change and our behavior.
- Upstream now ships its own sidebar sections/folders/groups feature, or
  removed or fundamentally replaced the flat sidebar list, drag and drop, or
  the active shelf our feature hooks into.
- The tests above still fail after a reasonable fix.
- Resolving would require touching server, contracts or persistence code.

## Report

Write exactly one line to the result file named at the end of your prompt:

- `RESOLVED: <one-line summary>` when every conflict is resolved, staged and
  all the tests above pass, or
- `ABORT: <reason>` otherwise.
