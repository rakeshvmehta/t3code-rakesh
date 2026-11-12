import { useEffect } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { randomUUID } from "../../lib/utils";
import {
  EMPTY_SIDEBAR_SECTIONS_STATE,
  SIDEBAR_SECTIONS_STORAGE_KEY,
  SidebarSectionsStateSchema,
  addSection,
  assignThread,
  deleteSection,
  moveSection,
  placeThread,
  pruneAssignments,
  renameSection,
  resolveLiveThreadKeys,
  rememberThreadOrder,
  toggleSectionCollapsed,
} from "./sidebarSections.logic";

// Sections live in this browser profile only; they never reach the server.
export function useSidebarSections(activeKeys: readonly string[]) {
  const [storedState, setState] = useLocalStorage(
    SIDEBAR_SECTIONS_STORAGE_KEY,
    EMPTY_SIDEBAR_SECTIONS_STATE,
    SidebarSectionsStateSchema,
  );
  const state = rememberThreadOrder(storedState, activeKeys);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- persist observed custom positions before Working temporarily removes rows
  useEffect(() => {
    if (state !== storedState) setState((current) => rememberThreadOrder(current, activeKeys));
  }, [state, storedState, activeKeys, setState]);
  return {
    state,
    add: (name: string) => {
      const id = randomUUID();
      setState((current) => addSection(current, id, name));
      return id;
    },
    rename: (id: string, name: string) => setState((current) => renameSection(current, id, name)),
    remove: (id: string) => setState((current) => deleteSection(current, id)),
    move: (id: string, delta: -1 | 1) => setState((current) => moveSection(current, id, delta)),
    toggle: (id: string | "chats") => setState((current) => toggleSectionCollapsed(current, id)),
    // Writes double as the lazy prune point: a user-driven drop only happens
    // once the thread list has loaded, so dead keys can be dropped safely.
    assign: (threadKey: string, sectionId: string | null, loadedThreadKeys?: readonly string[]) =>
      setState((current) => {
        const assigned = assignThread(current, threadKey, sectionId);
        return loadedThreadKeys
          ? pruneAssignments(assigned, resolveLiveThreadKeys(assigned, loadedThreadKeys))
          : assigned;
      }),
    place: (
      threadKey: string,
      sectionId: string | null,
      orderedKeys: readonly string[],
      loadedThreadKeys: readonly string[],
    ) =>
      setState((current) => {
        const placed = placeThread(
          rememberThreadOrder(current, activeKeys),
          threadKey,
          sectionId,
          orderedKeys,
        );
        return pruneAssignments(placed, resolveLiveThreadKeys(placed, loadedThreadKeys));
      }),
  };
}
