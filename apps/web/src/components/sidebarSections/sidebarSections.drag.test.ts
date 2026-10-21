import type { SortingStrategy } from "@dnd-kit/sortable";
import { describe, expect, it } from "vite-plus/test";

import { createSidebarCollisionDetection, createSidebarSortingStrategy } from "../Sidebar.drag.ts";
import { sidebarListItemId, sidebarMarkerId, type SidebarListItem } from "../Sidebar.logic.ts";
import { customSectionMarker } from "./sidebarSections.list.ts";

const row = (key: string, section: "pinned" | "active" = "active"): SidebarListItem => ({
  kind: "thread",
  key,
  section,
});
const A = sidebarMarkerId(customSectionMarker("a"));
const B = sidebarMarkerId(customSectionMarker("b"));
const CHATS = sidebarMarkerId("chats-header");

const items: SidebarListItem[] = [
  { kind: "marker", marker: "pinned-header" },
  row("p1", "pinned"),
  { kind: "marker", marker: "pinned-divider" },
  { kind: "marker", marker: "active-placeholder" },
  { kind: "marker", marker: customSectionMarker("a") },
  row("t2"),
  { kind: "marker", marker: customSectionMarker("b") },
  row("t3"),
  { kind: "marker", marker: "chats-header" },
  row("t1"),
  row("t5"),
  { kind: "marker", marker: "settled-header" },
  { kind: "marker", marker: "settled-placeholder" },
];

function preview(activeOrder: readonly string[] | undefined, active: string, over: string) {
  let top = 100;
  const rects = items.map((item) => {
    const height =
      item.kind === "thread"
        ? 82
        : item.marker === "pinned-header" ||
            item.marker === "pinned-divider" ||
            item.marker.endsWith("placeholder")
          ? 0
          : 32;
    const rect = { top, height, bottom: top + height, left: 0, right: 260, width: 260 };
    top += height + 1;
    return rect;
  });
  const strategy = createSidebarSortingStrategy({
    items,
    settledOrder: [],
    settledExpanded: false,
    ...(activeOrder ? { activeOrder } : {}),
  });
  const activeIndex = items.findIndex((item) => sidebarListItemId(item) === active);
  const args = {
    activeIndex,
    overIndex: items.findIndex((item) => sidebarListItemId(item) === over),
    activeNodeRect: rects[activeIndex]!,
    rects,
    index: 0,
  } satisfies Parameters<SortingStrategy>[0];
  return new Map(
    items.map((item, index) => [sidebarListItemId(item), strategy({ ...args, index })]),
  );
}

describe("sidebar drag projection with sections", () => {
  it("keeps section headers visible and opens the slot inside the target section", () => {
    const transforms = preview(undefined, "t1", B);
    for (const header of [A, B, CHATS]) expect(transforms.get(header)?.scaleY).toBe(1);
    // Rows shift by one card (82 + 1px gap) relative to the unmoved top header.
    const shift = (id: string) => transforms.get(id)!.y - transforms.get(A)!.y;
    expect(shift(B)).toBe(0);
    expect(shift("t3")).toBe(83);
    expect(shift(CHATS)).toBe(83);
    expect(shift("t5")).toBe(0);
  });

  it("previews a time-ordered drop at its time slot inside the target section", () => {
    const transforms = preview(["t2", "t1", "t3", "t5"], "t5", "t2");
    const shift = (id: string) => transforms.get(id)!.y - transforms.get(A)!.y;
    expect(shift("t2")).toBe(0);
    expect(shift(B)).toBe(83);
    expect(shift(CHATS)).toBe(83);
    expect(shift("t1")).toBe(83);
  });
});

describe("sidebar collision detection with sections", () => {
  it("targets a section header where it is drawn, not where it sat before the drag", () => {
    const list: SidebarListItem[] = [
      { kind: "marker", marker: "pinned-header" },
      { kind: "marker", marker: "pinned-divider" },
      { kind: "marker", marker: customSectionMarker("a") },
      row("t2"),
      { kind: "marker", marker: "chats-header" },
      row("t1"),
    ];
    let top = 100;
    const rects = list.map((item) => {
      const height = item.kind === "thread" ? 82 : item.marker.startsWith("pinned") ? 0 : 32;
      const rect = { top, height, bottom: top + height, left: 0, right: 260, width: 260 };
      top += height + 1;
      return rect;
    });
    // While dragging, the boundary labels push every row down by 50px.
    const live = (index: number) => ({
      ...rects[index]!,
      top: rects[index]!.top + 50,
      bottom: rects[index]!.bottom + 50,
    });
    const pointerY = live(2).top + 16;
    const collisionRect = {
      top: pointerY - 41,
      bottom: pointerY + 41,
      height: 82,
      left: 0,
      right: 260,
      width: 260,
    };
    const detector = createSidebarCollisionDetection(() => true, { items: list });
    const collisions = detector({
      active: {
        id: "t1",
        data: { current: {} },
        rect: { current: { initial: rects[5]!, translated: collisionRect } },
      },
      collisionRect,
      droppableRects: new Map(list.map((item, index) => [sidebarListItemId(item), rects[index]!])),
      droppableContainers: list.map((item, index) => ({
        id: sidebarListItemId(item),
        key: sidebarListItemId(item),
        disabled: false,
        data: { current: {} },
        node: {
          current: {
            getBoundingClientRect: () => live(index),
            querySelector: () => null,
          } as unknown as HTMLElement,
        },
        rect: { current: rects[index]! },
      })),
      pointerCoordinates: { x: 100, y: pointerY },
    });
    expect(collisions[0]?.id).toBe(A);
  });
});
