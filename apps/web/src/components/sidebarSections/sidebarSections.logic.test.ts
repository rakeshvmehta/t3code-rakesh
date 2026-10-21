import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_SIDEBAR_SECTIONS_STATE,
  addSection,
  assignThread,
  decodeSidebarSectionsState,
  deleteSection,
  groupActiveThreadKeys,
  moveSection,
  pruneAssignments,
  renameSection,
  resolveLiveThreadKeys,
  sectionIdForThread,
  toggleSectionCollapsed,
  upstreamActiveOrder,
  type SidebarSectionsState,
} from "./sidebarSections.logic.ts";

const twoSections = (): SidebarSectionsState =>
  addSection(addSection(EMPTY_SIDEBAR_SECTIONS_STATE, "a", "Alpha"), "b", "Beta");

describe("groupActiveThreadKeys", () => {
  it("puts every key in Chats when there are no sections", () => {
    expect(groupActiveThreadKeys(EMPTY_SIDEBAR_SECTIONS_STATE, ["t1", "t2"])).toEqual([
      { sectionId: null, name: "Chats", collapsed: false, threadKeys: ["t1", "t2"] },
    ]);
  });

  it("preserves input order within groups and sends unassigned and dangling keys to Chats", () => {
    let state = twoSections();
    state = assignThread(state, "t1", "b");
    state = assignThread(state, "t3", "a");
    state = assignThread(state, "t4", "b");
    state = { ...state, assignments: { ...state.assignments, t5: "deleted-section" } };

    const groups = groupActiveThreadKeys(state, ["t1", "t2", "t3", "t4", "t5"]);

    expect(groups.map((group) => [group.sectionId, group.threadKeys])).toEqual([
      ["a", ["t3"]],
      ["b", ["t1", "t4"]],
      [null, ["t2", "t5"]],
    ]);
  });

  it("includes empty sections in their display order", () => {
    const groups = groupActiveThreadKeys(twoSections(), []);
    expect(groups.map((group) => [group.sectionId, group.name, group.threadKeys])).toEqual([
      ["a", "Alpha", []],
      ["b", "Beta", []],
      [null, "Chats", []],
    ]);
  });

  it("carries collapse state for sections and Chats", () => {
    const state = toggleSectionCollapsed(toggleSectionCollapsed(twoSections(), "b"), "chats");
    expect(groupActiveThreadKeys(state, []).map((group) => group.collapsed)).toEqual([
      false,
      true,
      true,
    ]);
  });
});

describe("section mutations", () => {
  it("adds sections at the end with trimmed names", () => {
    const state = addSection(twoSections(), "c", "  Gamma  ");
    expect(state.sections.map((section) => [section.id, section.name])).toEqual([
      ["a", "Alpha"],
      ["b", "Beta"],
      ["c", "Gamma"],
    ]);
  });

  it("ignores an empty or whitespace name when adding or renaming", () => {
    const state = twoSections();
    expect(addSection(state, "c", "   ")).toBe(state);
    expect(renameSection(state, "a", "")).toBe(state);
    expect(renameSection(state, "a", "  ")).toBe(state);
  });

  it("renames a section", () => {
    expect(renameSection(twoSections(), "b", " Work ").sections[1]?.name).toBe("Work");
  });

  it("deleting a section moves its chats back to Chats", () => {
    let state = assignThread(assignThread(twoSections(), "t1", "a"), "t2", "b");
    state = deleteSection(state, "a");
    expect(state.sections.map((section) => section.id)).toEqual(["b"]);
    expect(state.assignments).toEqual({ t2: "b" });
    expect(sectionIdForThread(state, "t1")).toBeNull();
    expect(groupActiveThreadKeys(state, ["t1", "t2"]).at(-1)?.threadKeys).toEqual(["t1"]);
  });

  it("moves sections and clamps at the ends", () => {
    const state = addSection(twoSections(), "c", "Gamma");
    const ids = (s: SidebarSectionsState) => s.sections.map((section) => section.id);
    expect(ids(moveSection(state, "c", -1))).toEqual(["a", "c", "b"]);
    expect(ids(moveSection(state, "a", 1))).toEqual(["b", "a", "c"]);
    expect(moveSection(state, "a", -1)).toBe(state);
    expect(moveSection(state, "c", 1)).toBe(state);
    expect(moveSection(state, "missing", 1)).toBe(state);
  });

  it("assigning null returns a chat to Chats", () => {
    let state = assignThread(twoSections(), "t1", "a");
    expect(sectionIdForThread(state, "t1")).toBe("a");
    state = assignThread(state, "t1", null);
    expect(state.assignments).toEqual({});
    expect(sectionIdForThread(state, "t1")).toBeNull();
  });

  it("refuses to assign to a section that does not exist", () => {
    const state = twoSections();
    expect(assignThread(state, "t1", "missing")).toBe(state);
  });

  it("treats an assignment to a deleted section as Chats", () => {
    const state = { ...twoSections(), assignments: { t1: "gone" } };
    expect(sectionIdForThread(state, "t1")).toBeNull();
  });
});

describe("pruneAssignments", () => {
  it("drops keys for vanished chats and deleted sections", () => {
    const state: SidebarSectionsState = {
      ...twoSections(),
      assignments: { live: "a", vanished: "b", dangling: "gone" },
    };
    expect(pruneAssignments(state, new Set(["live", "dangling"])).assignments).toEqual({
      live: "a",
    });
  });

  it("returns the same state when nothing is dead", () => {
    const state = assignThread(twoSections(), "t1", "a");
    expect(pruneAssignments(state, new Set(["t1"]))).toBe(state);
  });
});

describe("decodeSidebarSectionsState", () => {
  it("round-trips a valid stored value", () => {
    const state = assignThread(toggleSectionCollapsed(twoSections(), "a"), "t1", "b");
    expect(decodeSidebarSectionsState(JSON.stringify(state))).toEqual(state);
  });

  it.each([
    ["missing", null],
    ["bad JSON", "{not json"],
    ["wrong shape", JSON.stringify({ sections: "nope" })],
    ["wrong section fields", JSON.stringify({ sections: [{ id: 1 }], assignments: {} })],
    ["array", "[]"],
  ])("falls back to the empty state when the value is %s", (_label, raw) => {
    expect(decodeSidebarSectionsState(raw)).toEqual(EMPTY_SIDEBAR_SECTIONS_STATE);
  });
});

describe("resolveLiveThreadKeys", () => {
  it("keeps assignments from environments that are not loaded, so offline chats survive pruning", () => {
    const state: SidebarSectionsState = {
      ...twoSections(),
      assignments: { "env1:live": "a", "env1:deleted": "a", "env2:offline": "b" },
    };
    const live = resolveLiveThreadKeys(state, ["env1:live", "env1:other"]);
    expect(pruneAssignments(state, live).assignments).toEqual({
      "env1:live": "a",
      "env2:offline": "b",
    });
  });
});

describe("upstreamActiveOrder", () => {
  // Upstream order t1..t5; A holds t2 and t4, B holds t3; t1 and t5 are in Chats.
  const upstreamKeys = ["t1", "t2", "t3", "t4", "t5"];
  const state = (): SidebarSectionsState => {
    let next = twoSections();
    next = assignThread(next, "t2", "a");
    next = assignThread(next, "t4", "a");
    return assignThread(next, "t3", "b");
  };

  it("moves only the dropped chat, before its next neighbour in the section", () => {
    // Rendered: A [t4, t2] after dropping t4 above t2, then B [t3], Chats [t1, t5].
    expect(
      upstreamActiveOrder({
        state: state(),
        upstreamKeys,
        groupedOrder: ["t4", "t2", "t3", "t1", "t5"],
        movedKey: "t4",
        movedSectionId: "a",
      }),
    ).toEqual(["t1", "t4", "t2", "t3", "t5"]);
  });

  it("places a chat dropped last in a section just after the previous one", () => {
    expect(
      upstreamActiveOrder({
        state: state(),
        upstreamKeys,
        groupedOrder: ["t2", "t4", "t1", "t3", "t5"],
        movedKey: "t1",
        movedSectionId: "a",
      }),
    ).toEqual(["t2", "t3", "t4", "t1", "t5"]);
  });

  it("keeps upstream order when the chat is alone in its section", () => {
    expect(
      upstreamActiveOrder({
        state: state(),
        upstreamKeys,
        groupedOrder: ["t2", "t4", "t3", "t5", "t1"],
        movedKey: "t5",
        movedSectionId: "c",
      }),
    ).toEqual(upstreamKeys);
  });

  it("puts a chat arriving from another shelf first when its section is empty", () => {
    expect(
      upstreamActiveOrder({
        state: state(),
        upstreamKeys,
        groupedOrder: ["t2", "t4", "t3", "p1", "t1", "t5"],
        movedKey: "p1",
        movedSectionId: "c",
      }),
    ).toEqual(["p1", ...upstreamKeys]);
  });

  it("differs from upstream order only in the moved chat's position", () => {
    const order = upstreamActiveOrder({
      state: state(),
      upstreamKeys,
      groupedOrder: ["t2", "t4", "t3", "t5", "t1"],
      movedKey: "t5",
      movedSectionId: null,
    });
    expect(order.filter((key) => key !== "t5")).toEqual(["t1", "t2", "t3", "t4"]);
  });
});
