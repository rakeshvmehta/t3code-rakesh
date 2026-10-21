import { describe, expect, it } from "vite-plus/test";

import {
  resolveSidebarDropTarget,
  sidebarListItemId,
  sidebarMarkerId,
  type SidebarListItem,
} from "../Sidebar.logic.ts";
import {
  EMPTY_SIDEBAR_SECTIONS_STATE,
  addSection,
  assignThread,
  groupActiveThreadKeys,
  toggleSectionCollapsed,
  type SidebarSectionsState,
} from "./sidebarSections.logic.ts";
import {
  buildActiveSectionItems,
  customSectionMarker,
  parseCustomSectionMarker,
  projectSectionedActiveArea,
  resolveDropSectionId,
} from "./sidebarSections.list.ts";

const ACTIVE_KEYS = ["t1", "t2", "t3", "t4", "t5"];

// Sections A (t2, t4) and B (t3), with t1 and t5 left in Chats.
function sectionedState(): SidebarSectionsState {
  let state = addSection(addSection(EMPTY_SIDEBAR_SECTIONS_STATE, "a", "A"), "b", "B");
  state = assignThread(state, "t2", "a");
  state = assignThread(state, "t4", "a");
  state = assignThread(state, "t3", "b");
  return state;
}

const row = (
  key: string,
  section: "pinned" | "active" | "settled" = "active",
): SidebarListItem => ({
  kind: "thread",
  key,
  section,
});

// The full sidebar list the way Sidebar.tsx assembles it.
function sidebarItems(
  state: SidebarSectionsState,
  mode: "visible" | "full",
  routeThreadKey: string | null = null,
): SidebarListItem[] {
  return [
    { kind: "marker", marker: "pinned-header" },
    row("p1", "pinned"),
    { kind: "marker", marker: "pinned-divider" },
    { kind: "marker", marker: "active-placeholder" },
    ...buildActiveSectionItems(groupActiveThreadKeys(state, ACTIVE_KEYS), routeThreadKey, mode),
    { kind: "marker", marker: "settled-header" },
    { kind: "marker", marker: "settled-placeholder" },
    row("s1", "settled"),
  ];
}

const ids = (items: readonly SidebarListItem[]) => items.map(sidebarListItemId);
const A = sidebarMarkerId(customSectionMarker("a"));
const B = sidebarMarkerId(customSectionMarker("b"));
const CHATS = sidebarMarkerId("chats-header");

describe("section markers", () => {
  it("round-trips a custom section marker", () => {
    expect(customSectionMarker("abc")).toBe("custom-section:abc");
    expect(parseCustomSectionMarker(customSectionMarker("abc"))).toBe("abc");
    expect(parseCustomSectionMarker("chats-header")).toBeNull();
    expect(parseCustomSectionMarker("settled-header")).toBeNull();
  });
});

describe("buildActiveSectionItems", () => {
  it("emits only rows, exactly like upstream, when there are no custom sections", () => {
    const groups = groupActiveThreadKeys(EMPTY_SIDEBAR_SECTIONS_STATE, ACTIVE_KEYS);
    expect(buildActiveSectionItems(groups, null, "visible")).toEqual(
      ACTIVE_KEYS.map((key) => row(key)),
    );
  });

  it("ignores a stale Chats collapse flag when there are no custom sections", () => {
    const state = toggleSectionCollapsed(EMPTY_SIDEBAR_SECTIONS_STATE, "chats");
    const groups = groupActiveThreadKeys(state, ACTIVE_KEYS);
    expect(buildActiveSectionItems(groups, null, "visible")).toHaveLength(ACTIVE_KEYS.length);
  });

  it("orders each header before its rows, custom sections first, then Chats", () => {
    const items = buildActiveSectionItems(
      groupActiveThreadKeys(sectionedState(), ACTIVE_KEYS),
      null,
      "visible",
    );
    expect(ids(items)).toEqual([A, "t2", "t4", B, "t3", CHATS, "t1", "t5"]);
  });

  it("emits only the header of a collapsed section, plus the route row", () => {
    const state = toggleSectionCollapsed(sectionedState(), "a");
    const groups = groupActiveThreadKeys(state, ACTIVE_KEYS);
    expect(ids(buildActiveSectionItems(groups, null, "visible"))).toEqual([
      A,
      B,
      "t3",
      CHATS,
      "t1",
      "t5",
    ]);
    expect(ids(buildActiveSectionItems(groups, "t4", "visible"))).toEqual([
      A,
      "t4",
      B,
      "t3",
      CHATS,
      "t1",
      "t5",
    ]);
  });

  it("collapses Chats too", () => {
    const state = toggleSectionCollapsed(sectionedState(), "chats");
    const groups = groupActiveThreadKeys(state, ACTIVE_KEYS);
    expect(ids(buildActiveSectionItems(groups, null, "visible"))).toEqual([
      A,
      "t2",
      "t4",
      B,
      "t3",
      CHATS,
    ]);
  });

  it("emits every row in full mode", () => {
    const state = toggleSectionCollapsed(toggleSectionCollapsed(sectionedState(), "a"), "chats");
    const groups = groupActiveThreadKeys(state, ACTIVE_KEYS);
    expect(ids(buildActiveSectionItems(groups, null, "full"))).toEqual([
      A,
      "t2",
      "t4",
      B,
      "t3",
      CHATS,
      "t1",
      "t5",
    ]);
  });
});

describe("resolveDropSectionId", () => {
  const items = sidebarItems(sectionedState(), "full");

  it("returns the section of the row dropped onto", () => {
    expect(resolveDropSectionId(items, "t1", "t2")).toBe("a");
    expect(resolveDropSectionId(items, "t1", "t3")).toBe("b");
    expect(resolveDropSectionId(items, "t2", "t5")).toBeNull();
  });

  it("keeps a chat in its own section when reordered within it", () => {
    expect(resolveDropSectionId(items, "t4", "t2")).toBe("a");
    expect(resolveDropSectionId(items, "t2", "t4")).toBe("a");
  });

  it("joins the header's section when dropped on a header, from above or below", () => {
    // From below: arrayMove alone would land the chat before B, inside A.
    expect(resolveDropSectionId(items, "t5", B)).toBe("b");
    expect(resolveDropSectionId(items, "t2", B)).toBe("b");
    expect(resolveDropSectionId(items, "t1", A)).toBe("a");
    expect(resolveDropSectionId(items, "t3", CHATS)).toBeNull();
    expect(resolveDropSectionId(items, "p1", A)).toBe("a");
  });

  it("joins a collapsed or empty section via its header", () => {
    const collapsed = sidebarItems(toggleSectionCollapsed(sectionedState(), "b"), "visible");
    expect(resolveDropSectionId(collapsed, "t1", B)).toBe("b");
    const empty = sidebarItems(addSection(sectionedState(), "c", "C"), "full");
    expect(resolveDropSectionId(empty, "t1", sidebarMarkerId(customSectionMarker("c")))).toBe("c");
  });

  it("gives the first section to a slot above every header", () => {
    expect(resolveDropSectionId(items, "t1", sidebarMarkerId("active-placeholder"))).toBe("a");
  });

  it("is undefined outside the active area", () => {
    expect(resolveDropSectionId(items, "t1", "p1")).toBeUndefined();
    expect(resolveDropSectionId(items, "t1", "s1")).toBeUndefined();
    expect(resolveDropSectionId(items, "t1", sidebarMarkerId("settled-header"))).toBeUndefined();
    expect(resolveDropSectionId(items, "missing", "t2")).toBeUndefined();
  });

  it("returns Chats when there are no custom sections", () => {
    const plain = sidebarItems(EMPTY_SIDEBAR_SECTIONS_STATE, "full");
    expect(resolveDropSectionId(plain, "t1", "t4")).toBeNull();
    expect(resolveDropSectionId(plain, "p1", "t2")).toBeNull();
  });
});

describe("drop targets on the full list", () => {
  it("keeps rows hidden by a collapsed section in the active order", () => {
    const state = toggleSectionCollapsed(sectionedState(), "a");
    const full = sidebarItems(state, "full");
    const target = resolveSidebarDropTarget(full, "t5", B);
    expect(target?.section).toBe("active");
    expect(target?.activeOrder).toEqual(["t2", "t4", "t5", "t3", "t1"]);
  });
});

describe("projectSectionedActiveArea", () => {
  it("is null without section headers, so upstream projection applies", () => {
    const plain = sidebarItems(EMPTY_SIDEBAR_SECTIONS_STATE, "visible");
    expect(
      projectSectionedActiveArea({
        items: plain,
        activeKey: "t1",
        overId: "t3",
        targetSection: "active",
        order: [],
      }),
    ).toBeNull();
  });

  it("keeps headers in place and previews the chat inside its target section", () => {
    const items = sidebarItems(sectionedState(), "visible");
    const target = resolveSidebarDropTarget(items, "t1", B)!;
    const projected = projectSectionedActiveArea({
      items,
      activeKey: "t1",
      overId: B,
      targetSection: "active",
      order: target.activeOrder,
    });
    expect(ids(projected!)).toEqual([A, "t2", "t4", B, "t1", "t3", CHATS, "t5"]);
  });

  it("previews time-ordered placement within the target section", () => {
    const items = sidebarItems(sectionedState(), "visible");
    const projected = projectSectionedActiveArea({
      items,
      activeKey: "t1",
      overId: "t2",
      targetSection: "active",
      order: ["t2", "t4", "t1", "t3", "t5"],
    });
    expect(ids(projected!)).toEqual([A, "t2", "t4", "t1", B, "t3", CHATS, "t5"]);
  });

  it("leaves the chat out when it is headed for another shelf", () => {
    const items = sidebarItems(sectionedState(), "visible");
    const projected = projectSectionedActiveArea({
      items,
      activeKey: "t2",
      overId: "s1",
      targetSection: "settled",
      order: [],
    });
    expect(ids(projected!)).toEqual([A, "t4", B, "t3", CHATS, "t1", "t5"]);
  });
});
