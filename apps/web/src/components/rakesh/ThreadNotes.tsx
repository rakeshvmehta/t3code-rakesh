import { useAtomValue } from "@effect/atom-react";
import type { ContextMenuItem, LocalApi } from "@t3tools/contracts";
import { StickyNoteIcon } from "lucide-react";
import { useState } from "react";

import {
  organizationViewAtom,
  threadOrganizationNote,
} from "../../state/sidebarOrganization/state";
import { useOrganizationActions } from "../../state/sidebarOrganization/useOrganizationActions";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import {
  THREAD_NOTE_MAX_LENGTH,
  threadNotePreview,
  withThreadNoteMenuItems,
  type ThreadNoteMenuId,
} from "./threadNotes.logic";

export function useThreadNotePreview(threadKey: string) {
  return threadNotePreview(useAtomValue(threadOrganizationNote(threadKey)));
}

export function ThreadNotePreview({ preview }: { preview: string | null }) {
  if (preview === null) return null;
  return (
    <div className="my-1.5 min-w-0 rounded-xs border-l-2 border-warning bg-warning/10 px-2 py-1.5 text-xs text-foreground select-text">
      <div className="line-clamp-2 wrap-break-word">{preview}</div>
    </div>
  );
}

// The note line at the top of a thread's hover card; nothing when unset.
export function ThreadNoteHoverLine({ threadKey }: { threadKey: string }) {
  const note = useAtomValue(threadOrganizationNote(threadKey));
  if (note === undefined) return null;
  return (
    <div className="flex min-w-0 items-start gap-2 text-foreground">
      <StickyNoteIcon aria-hidden className="mt-0.5 size-3 shrink-0 stroke-muted-foreground" />
      <div className="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word">{note}</div>
    </div>
  );
}

// Everything the sidebar needs: the menu entries, their handler, the dialog to
// render, and cleanup for deleted threads.
export function useThreadNotesController() {
  const notes = useAtomValue(organizationViewAtom).notes;
  const actions = useOrganizationActions();
  const [editing, setEditing] = useState<{ threadKey: string; title: string } | null>(null);
  const forget = (threadKeys: Iterable<string>) => {
    for (const threadKey of threadKeys)
      void actions.mutate({ type: "thread.note", threadKey, note: null });
  };
  return {
    // Stands in for contextMenu.show on a single thread's menu.
    showMenu: <T extends string>(
      contextMenu: LocalApi["contextMenu"],
      threadKey: string,
      items: ReadonlyArray<ContextMenuItem<T>>,
      position: { x: number; y: number },
    ) =>
      contextMenu.show(
        withThreadNoteMenuItems(items, notes[threadKey] !== undefined).map((item) =>
          item.id === "rakesh-note:edit" || item.id === "rakesh-note:clear"
            ? { ...item, disabled: !actions.canChangeThread(threadKey) }
            : item,
        ),
        position,
      ),
    handleMenu: (id: ThreadNoteMenuId, threadKey: string, title: string) => {
      if (!actions.canChangeThread(threadKey)) return;
      if (id === "rakesh-note:clear") forget([threadKey]);
      else setEditing({ threadKey, title });
    },
    forget,
    dialog: editing ? (
      <ThreadNoteDialog
        title={editing.title}
        initialNote={notes[editing.threadKey] ?? ""}
        onClose={async (note) => {
          if (
            note === null ||
            (await actions.mutate({ type: "thread.note", threadKey: editing.threadKey, note }))
          )
            setEditing(null);
        }}
      />
    ) : null,
  };
}

function ThreadNoteDialog({
  title,
  initialNote,
  onClose,
}: {
  title: string;
  initialNote: string;
  onClose: (note: string | null) => Promise<void>;
}) {
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const remaining = THREAD_NOTE_MAX_LENGTH - note.length;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) void onClose(null);
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            setSaving(true);
            void onClose(note).finally(() => setSaving(false));
          }}
        >
          <DialogHeader>
            <DialogTitle>{initialNote ? "Edit note" : "Add note"}</DialogTitle>
            <DialogDescription>{title}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Textarea
              autoFocus
              disabled={saving}
              aria-label="Note"
              placeholder="e.g. Done, but blocked until staging is back up"
              maxLength={THREAD_NOTE_MAX_LENGTH}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                // Enter saves; Shift+Enter starts a new line.
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            {remaining <= 100 && (
              <p className="mt-1.5 text-right text-xs text-muted-foreground">
                {remaining} characters left
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => void onClose(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
