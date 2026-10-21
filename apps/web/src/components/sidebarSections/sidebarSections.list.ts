import {
  resolveSidebarDropTarget,
  sidebarListItemId,
  type SidebarListItem,
  type SidebarListMarker,
} from "../Sidebar.logic";
import type { ActiveSectionGroup } from "./sidebarSections.logic";

const CUSTOM_SECTION_PREFIX = "custom-section:";

export function customSectionMarker(sectionId: string): SidebarListMarker {
  return `${CUSTOM_SECTION_PREFIX}${sectionId}`;
}

export function parseCustomSectionMarker(marker: SidebarListMarker): string | null {
  return marker.startsWith(CUSTOM_SECTION_PREFIX)
    ? marker.slice(CUSTOM_SECTION_PREFIX.length)
    : null;
}

// The section a header row opens: its id, null for Chats, undefined for any
// other marker.
function headerSectionId(item: SidebarListItem | undefined): string | null | undefined {
  if (item?.kind !== "marker") return undefined;
  if (item.marker === "chats-header") return null;
  return parseCustomSectionMarker(item.marker) ?? undefined;
}

const isShelfHeader = (item: SidebarListItem) =>
  item.kind === "marker" &&
  (item.marker === "working-header" ||
    item.marker === "snoozed-header" ||
    item.marker === "settled-header");

export function buildActiveSectionItems(
  groups: readonly ActiveSectionGroup[],
  routeThreadKey: string | null,
  mode: "visible" | "full",
): SidebarListItem[] {
  const row = (key: string): SidebarListItem => ({ kind: "thread", key, section: "active" });
  // Only Chats: no headers at all, so the list matches upstream exactly.
  if (groups.length <= 1) return groups.flatMap((group) => group.threadKeys.map(row));
  const items: SidebarListItem[] = [];
  for (const group of groups) {
    items.push({
      kind: "marker",
      marker: group.sectionId === null ? "chats-header" : customSectionMarker(group.sectionId),
    });
    const keys =
      mode === "full" || !group.collapsed
        ? group.threadKeys
        : group.threadKeys.filter((key) => key === routeThreadKey);
    items.push(...keys.map(row));
  }
  return items;
}

function sectionOwningSlot(items: readonly SidebarListItem[], index: number): string | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const item = items[i]!;
    const sectionId = headerSectionId(item);
    if (sectionId !== undefined) return sectionId;
    if (item.kind === "marker" && item.marker === "pinned-divider") break;
  }
  // A slot above every header sits at the top of the first section shown.
  for (let i = index + 1; i < items.length; i += 1) {
    const item = items[i]!;
    const sectionId = headerSectionId(item);
    if (sectionId !== undefined) return sectionId;
    if (isShelfHeader(item)) break;
  }
  return null;
}

export function resolveDropSectionId(
  items: readonly SidebarListItem[],
  activeKey: string,
  overId: string,
): string | null | undefined {
  if (resolveSidebarDropTarget(items, activeKey, overId)?.section !== "active") return undefined;
  const overIndex = items.findIndex((item) => sidebarListItemId(item) === overId);
  // arrayMove would leave an upward drop just above the header, in the
  // previous section; a header always means "into this section".
  const overSectionId = headerSectionId(items[overIndex]);
  if (overSectionId !== undefined) return overSectionId;
  const activeIndex = items.findIndex((item) => sidebarListItemId(item) === activeKey);
  const moved = items.filter((_, index) => index !== activeIndex);
  moved.splice(overIndex, 0, items[activeIndex]!);
  return sectionOwningSlot(moved, overIndex);
}

// The active area as it would look after the drop, for the drag preview.
// Null when there are no section headers, so the upstream projection applies.
export function projectSectionedActiveArea(input: {
  readonly items: readonly SidebarListItem[];
  readonly activeKey: string;
  readonly overId: string;
  readonly targetSection: "pinned" | "active" | "settled";
  readonly order: readonly string[];
}): SidebarListItem[] | null {
  const { items, activeKey } = input;
  if (!items.some((item) => headerSectionId(item) !== undefined)) return null;
  const area: SidebarListItem[] = [];
  const start = items.findIndex(
    (item) => item.kind === "marker" && item.marker === "pinned-divider",
  );
  for (const item of items.slice(start + 1)) {
    if (isShelfHeader(item)) break;
    if (item.kind === "thread" ? item.key === activeKey : item.marker === "active-placeholder") {
      continue;
    }
    area.push(item);
  }
  if (input.targetSection !== "active") return area;
  const sectionId = resolveDropSectionId(items, activeKey, input.overId) ?? null;
  const headerIndex = area.findIndex((item) => headerSectionId(item) === sectionId);
  const ranks = new Map(input.order.map((key, index) => [key, index]));
  const rankOf = (item: SidebarListItem) =>
    item.kind === "thread" ? (ranks.get(item.key) ?? Number.POSITIVE_INFINITY) : -1;
  const rank = ranks.get(activeKey) ?? Number.POSITIVE_INFINITY;
  let at = headerIndex + 1;
  while (at < area.length && area[at]!.kind === "thread" && rankOf(area[at]!) <= rank) at += 1;
  area.splice(at, 0, { kind: "thread", key: activeKey, section: "active" });
  return area;
}
