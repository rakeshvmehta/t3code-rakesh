import { useState, type ReactNode } from "react";

import type { SidebarListItem, SidebarListMarker } from "../Sidebar.logic";
import { SidebarCustomSectionHeader } from "./SidebarSectionHeader";
import {
  buildActiveSectionItems,
  orderSidebarThreadKeys,
  parseCustomSectionMarker,
  resolveDropSectionId,
} from "./sidebarSections.list";
import { groupActiveThreadKeys, sectionIdForThread } from "./sidebarSections.logic";
import { useSidebarSections } from "./useSidebarSections";

const NEW_SECTION_NAME = "New section";

// Everything Sidebar.tsx needs for custom sections, so its own edits stay a
// handful of call sites. With no custom sections every output matches upstream.
export function useSidebarSectionsController(input: {
  readonly activeKeys: readonly string[];
  readonly routeThreadKey: string | null;
}) {
  const { activeKeys, routeThreadKey } = input;
  const sections = useSidebarSections();
  const { state } = sections;
  const [editing, setEditing] = useState<{ id: string; isNew: boolean } | null>(null);
  // undefined: the pointer is not over the active area.
  const [dropTargetSectionId, setDropTargetSectionId] = useState<string | null | undefined>();
  const hasCustomSections = state.sections.length > 0;
  const groups = groupActiveThreadKeys(state, activeKeys);
  const visibleActiveItems = buildActiveSectionItems(groups, routeThreadKey, "visible");

  const resolveChange = (
    fullItems: readonly SidebarListItem[],
    activeKey: string,
    overId: string,
  ) => {
    const sectionId = resolveDropSectionId(fullItems, activeKey, overId);
    return sectionId !== undefined && sectionId !== sectionIdForThread(state, activeKey)
      ? { sectionId }
      : null;
  };

  const renderHeader = (marker: SidebarListMarker, dragging: boolean): ReactNode | null => {
    const sectionId = marker === "chats-header" ? null : parseCustomSectionMarker(marker);
    if (sectionId === null && marker !== "chats-header") return null;
    const index = groups.findIndex((group) => group.sectionId === sectionId);
    const group = groups[index];
    if (group === undefined) return null;
    const customCount = groups.length - 1;
    return (
      <SidebarCustomSectionHeader
        name={group.name}
        count={group.threadKeys.length}
        expanded={!group.collapsed}
        onToggle={() => sections.toggle(sectionId ?? "chats")}
        dragging={dragging}
        isDropTarget={dragging && dropTargetSectionId === sectionId}
        testId={
          sectionId === null ? "sidebar-chats-section-toggle" : "sidebar-custom-section-toggle"
        }
        menu={
          sectionId === null
            ? null
            : {
                canMoveUp: index > 0,
                canMoveDown: index < customCount - 1,
                onRename: () => setEditing({ id: sectionId, isNew: false }),
                onMoveUp: () => sections.move(sectionId, -1),
                onMoveDown: () => sections.move(sectionId, 1),
                onDelete: () => sections.remove(sectionId),
              }
        }
        editing={sectionId !== null && editing?.id === sectionId}
        onCommitName={(name) => {
          if (sectionId !== null) sections.rename(sectionId, name);
          setEditing(null);
        }}
        onCancelEdit={() => {
          if (sectionId !== null && editing?.isNew) sections.remove(sectionId);
          setEditing(null);
        }}
      />
    );
  };

  return {
    hasCustomSections,
    activeItems: (mode: "visible" | "full"): readonly SidebarListItem[] =>
      mode === "visible"
        ? visibleActiveItems
        : buildActiveSectionItems(groups, routeThreadKey, "full"),
    // The order drops are planned against: the rendered grouping, hidden rows included.
    activeOrder: hasCustomSections ? groups.flatMap((group) => group.threadKeys) : activeKeys,
    orderThreadKeys: (orderedKeys: readonly string[]) =>
      hasCustomSections
        ? orderSidebarThreadKeys(
            orderedKeys,
            activeKeys,
            visibleActiveItems.flatMap((item) => (item.kind === "thread" ? [item.key] : [])),
          )
        : orderedKeys,
    changesSection: (fullItems: readonly SidebarListItem[], activeKey: string, overId: string) =>
      resolveChange(fullItems, activeKey, overId) !== null,
    trackDragOver: (
      fullItems: readonly SidebarListItem[],
      activeKey: string,
      overId: string | null,
    ) =>
      setDropTargetSectionId(
        overId === null ? undefined : resolveDropSectionId(fullItems, activeKey, overId),
      ),
    // Applies the section half of a drop; the upstream plan still handles
    // pin, settle, wake and ordering.
    applyDrop: (
      fullItems: readonly SidebarListItem[],
      activeKey: string,
      overId: string,
      loadedThreadKeys: readonly string[],
    ) => {
      setDropTargetSectionId(undefined);
      const change = resolveChange(fullItems, activeKey, overId);
      if (change) sections.assign(activeKey, change.sectionId, loadedThreadKeys);
    },
    startNewSection: () => {
      const id = sections.add(NEW_SECTION_NAME);
      setEditing({ id, isNew: true });
    },
    renderHeader,
  };
}
