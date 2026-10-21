import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { readLocalApi } from "../../localApi";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";

type SectionMenuAction = "rename" | "move-up" | "move-down" | "delete";

export interface SidebarSectionMenu {
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onRename: () => void;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
  readonly onDelete: () => void;
}

// Header row for a custom section or Chats. It mirrors the Settled shelf
// header; Sidebar wraps it in the sortable marker row so drops can target it.
export function SidebarCustomSectionHeader(props: {
  name: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  dragging: boolean;
  isDropTarget: boolean;
  testId: string;
  // Custom sections only; Chats has no menu and cannot be renamed.
  menu: SidebarSectionMenu | null;
  editing: boolean;
  onCommitName: (name: string) => void;
  onCancelEdit: () => void;
}) {
  const { menu } = props;
  const showMenu = (position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api || !menu) return;
    void api.contextMenu
      .show<SectionMenuAction>(
        [
          { id: "rename", label: "Rename" },
          { id: "move-up", label: "Move up", disabled: !menu.canMoveUp },
          { id: "move-down", label: "Move down", disabled: !menu.canMoveDown },
          { id: "delete", label: "Delete", destructive: true, separatorBefore: true },
        ],
        position,
      )
      .then((action) => {
        if (action === "rename") menu.onRename();
        else if (action === "move-up") menu.onMoveUp();
        else if (action === "move-down") menu.onMoveDown();
        else if (action === "delete") menu.onDelete();
      })
      .catch(() => {});
  };

  if (props.editing) {
    return (
      <SectionNameInput
        initialName={props.name}
        onCommit={props.onCommitName}
        onCancel={props.onCancelEdit}
      />
    );
  }
  return (
    <CollapsibleSectionHeader
      onClick={props.onToggle}
      onContextMenu={(event) => {
        if (!menu) return;
        event.preventDefault();
        showMenu({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (!menu) return;
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          showMenu({ x: rect.left, y: rect.bottom });
        }
      }}
      expanded={props.expanded}
      tone={props.isDropTarget ? "accent" : props.dragging ? "emphasized" : "muted"}
      data-testid={props.testId}
    >
      {props.expanded ? props.name : `${props.name} (${props.count})`}
    </CollapsibleSectionHeader>
  );
}

function SectionNameInput(props: {
  initialName: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(props.initialName);
  const doneRef = useRef(false);
  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit && value.trim().length > 0) props.onCommit(value);
    else props.onCancel();
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  };
  return (
    <div className="flex h-8 items-center px-1">
      <input
        autoFocus
        value={value}
        aria-label="Section name"
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={handleKeyDown}
        onBlur={() => finish(true)}
        className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-xs font-medium text-card-foreground outline-none focus:border-foreground"
      />
    </div>
  );
}
