import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const SIDEBAR_SECTIONS_STORAGE_KEY = "t3code:rakesh:sidebar-sections:v1";

export const CHATS_SECTION_NAME = "Chats";

export type SidebarCustomSection = {
  readonly id: string;
  readonly name: string;
  readonly collapsed: boolean;
};

export type SidebarSectionsState = {
  readonly sections: readonly SidebarCustomSection[];
  readonly assignments: Readonly<Record<string, string>>;
  readonly chatsCollapsed: boolean;
};

export const EMPTY_SIDEBAR_SECTIONS_STATE: SidebarSectionsState = {
  sections: [],
  assignments: {},
  chatsCollapsed: false,
};

export const SidebarSectionsStateSchema = Schema.Struct({
  sections: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, collapsed: Schema.Boolean }),
  ),
  assignments: Schema.Record(Schema.String, Schema.String),
  chatsCollapsed: Schema.Boolean,
});

const decodeStored = Schema.decodeUnknownOption(Schema.fromJsonString(SidebarSectionsStateSchema));

// Mirrors useLocalStorage's read path: anything unreadable means "no sections".
export function decodeSidebarSectionsState(raw: string | null): SidebarSectionsState {
  if (raw === null) return EMPTY_SIDEBAR_SECTIONS_STATE;
  return Option.getOrElse(decodeStored(raw), () => EMPTY_SIDEBAR_SECTIONS_STATE);
}

const hasSection = (state: SidebarSectionsState, id: string) =>
  state.sections.some((section) => section.id === id);

export function addSection(
  state: SidebarSectionsState,
  id: string,
  name: string,
): SidebarSectionsState {
  const trimmed = name.trim();
  if (trimmed.length === 0 || hasSection(state, id)) return state;
  return { ...state, sections: [...state.sections, { id, name: trimmed, collapsed: false }] };
}

export function renameSection(
  state: SidebarSectionsState,
  id: string,
  name: string,
): SidebarSectionsState {
  const trimmed = name.trim();
  if (trimmed.length === 0 || !hasSection(state, id)) return state;
  return {
    ...state,
    sections: state.sections.map((section) =>
      section.id === id ? { ...section, name: trimmed } : section,
    ),
  };
}

export function deleteSection(state: SidebarSectionsState, id: string): SidebarSectionsState {
  if (!hasSection(state, id)) return state;
  return {
    ...state,
    sections: state.sections.filter((section) => section.id !== id),
    assignments: Object.fromEntries(
      Object.entries(state.assignments).filter(([, sectionId]) => sectionId !== id),
    ),
  };
}

export function moveSection(
  state: SidebarSectionsState,
  id: string,
  delta: -1 | 1,
): SidebarSectionsState {
  const index = state.sections.findIndex((section) => section.id === id);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= state.sections.length) return state;
  const sections = [...state.sections];
  [sections[index], sections[target]] = [sections[target]!, sections[index]!];
  return { ...state, sections };
}

export function toggleSectionCollapsed(
  state: SidebarSectionsState,
  id: string | "chats",
): SidebarSectionsState {
  if (id === "chats") return { ...state, chatsCollapsed: !state.chatsCollapsed };
  if (!hasSection(state, id)) return state;
  return {
    ...state,
    sections: state.sections.map((section) =>
      section.id === id ? { ...section, collapsed: !section.collapsed } : section,
    ),
  };
}

export function assignThread(
  state: SidebarSectionsState,
  threadKey: string,
  sectionId: string | null,
): SidebarSectionsState {
  if (sectionId === null) {
    if (!(threadKey in state.assignments)) return state;
    const { [threadKey]: _removed, ...assignments } = state.assignments;
    return { ...state, assignments };
  }
  if (!hasSection(state, sectionId) || state.assignments[threadKey] === sectionId) return state;
  return { ...state, assignments: { ...state.assignments, [threadKey]: sectionId } };
}

// Drops assignments whose chat is gone or whose section was deleted. Only call
// with a fully loaded thread list, or live assignments would be lost.
export function pruneAssignments(
  state: SidebarSectionsState,
  liveThreadKeys: ReadonlySet<string>,
): SidebarSectionsState {
  const entries = Object.entries(state.assignments);
  const kept = entries.filter(
    ([threadKey, sectionId]) => liveThreadKeys.has(threadKey) && hasSection(state, sectionId),
  );
  return kept.length === entries.length
    ? state
    : { ...state, assignments: Object.fromEntries(kept) };
}

export function sectionIdForThread(state: SidebarSectionsState, threadKey: string): string | null {
  const sectionId = state.assignments[threadKey];
  return sectionId !== undefined && hasSection(state, sectionId) ? sectionId : null;
}

export type ActiveSectionGroup = {
  readonly sectionId: string | null;
  readonly name: string;
  readonly collapsed: boolean;
  readonly threadKeys: readonly string[];
};

export function groupActiveThreadKeys(
  state: SidebarSectionsState,
  orderedActiveKeys: readonly string[],
): readonly ActiveSectionGroup[] {
  const keysBySection = new Map<string | null, string[]>([[null, []]]);
  for (const section of state.sections) keysBySection.set(section.id, []);
  for (const key of orderedActiveKeys) {
    keysBySection.get(sectionIdForThread(state, key))!.push(key);
  }
  return [
    ...state.sections.map((section) => ({
      sectionId: section.id,
      name: section.name,
      collapsed: section.collapsed,
      threadKeys: keysBySection.get(section.id)!,
    })),
    {
      sectionId: null,
      name: CHATS_SECTION_NAME,
      collapsed: state.chatsCollapsed,
      threadKeys: keysBySection.get(null)!,
    },
  ];
}
