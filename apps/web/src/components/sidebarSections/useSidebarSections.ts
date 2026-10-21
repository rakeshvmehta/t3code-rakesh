import { useLocalStorage } from "../../hooks/useLocalStorage";
import {
  EMPTY_SIDEBAR_SECTIONS_STATE,
  SIDEBAR_SECTIONS_STORAGE_KEY,
  SidebarSectionsStateSchema,
  addSection,
  assignThread,
  deleteSection,
  moveSection,
  pruneAssignments,
  renameSection,
  toggleSectionCollapsed,
} from "./sidebarSections.logic";

// Sections live in this browser profile only; they never reach the server.
export function useSidebarSections() {
  const [state, setState] = useLocalStorage(
    SIDEBAR_SECTIONS_STORAGE_KEY,
    EMPTY_SIDEBAR_SECTIONS_STATE,
    SidebarSectionsStateSchema,
  );
  return {
    state,
    add: (name: string) => {
      const id = crypto.randomUUID();
      setState((current) => addSection(current, id, name));
      return id;
    },
    rename: (id: string, name: string) => setState((current) => renameSection(current, id, name)),
    remove: (id: string) => setState((current) => deleteSection(current, id)),
    move: (id: string, delta: -1 | 1) => setState((current) => moveSection(current, id, delta)),
    toggle: (id: string | "chats") => setState((current) => toggleSectionCollapsed(current, id)),
    // Writes double as the lazy prune point: a user-driven drop only happens
    // once the thread list has loaded, so dead keys can be dropped safely.
    assign: (threadKey: string, sectionId: string | null, liveThreadKeys?: ReadonlySet<string>) =>
      setState((current) => {
        const assigned = assignThread(current, threadKey, sectionId);
        return liveThreadKeys ? pruneAssignments(assigned, liveThreadKeys) : assigned;
      }),
  };
}
