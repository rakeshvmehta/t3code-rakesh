import type { ContextMenuItem, LocalApi } from "@t3tools/contracts";
import { StickyNoteIcon } from "lucide-react";
import { useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
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
  EMPTY_THREAD_NOTES,
  THREAD_NOTES_STORAGE_KEY,
  THREAD_NOTE_MAX_LENGTH,
  ThreadNotesSchema,
  removeThreadNotes,
  setThreadNote,
  withThreadNoteMenuItems,
  type ThreadNoteMenuId,
} from "./threadNotes.logic";

function useThreadNotes() {
  return useLocalStorage(THREAD_NOTES_STORAGE_KEY, EMPTY_THREAD_NOTES, ThreadNotesSchema);
}

// The note line at the top of a thread's hover card; nothing when unset.
export function ThreadNoteHoverLine({ threadKey }: { threadKey: string }) {
  const [notes] = useThreadNotes();
  const note = notes[threadKey];
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
  const [notes, setNotes] = useThreadNotes();
  const [editing, setEditing] = useState<{ threadKey: string; title: string } | null>(null);
  const forget = (threadKeys: Iterable<string>) =>
    setNotes((current) => removeThreadNotes(current, threadKeys));
  return {
    // Stands in for contextMenu.show on a single thread's menu.
    showMenu: <T extends string>(
      contextMenu: LocalApi["contextMenu"],
      threadKey: string,
      items: ReadonlyArray<ContextMenuItem<T>>,
      position: { x: number; y: number },
    ) => contextMenu.show(withThreadNoteMenuItems(items, notes[threadKey] !== undefined), position),
    handleMenu: (id: ThreadNoteMenuId, threadKey: string, title: string) => {
      if (id === "rakesh-note:clear") forget([threadKey]);
      else setEditing({ threadKey, title });
    },
    forget,
    dialog: editing ? (
      <ThreadNoteDialog
        title={editing.title}
        initialNote={notes[editing.threadKey] ?? ""}
        onClose={(note) => {
          if (note !== null) setNotes((current) => setThreadNote(current, editing.threadKey, note));
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
  onClose: (note: string | null) => void;
}) {
  const [note, setNote] = useState(initialNote);
  const remaining = THREAD_NOTE_MAX_LENGTH - note.length;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose(null);
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onClose(note);
          }}
        >
          <DialogHeader>
            <DialogTitle>{initialNote ? "Edit note" : "Add note"}</DialogTitle>
            <DialogDescription>{title}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Textarea
              autoFocus
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
            <Button type="button" variant="outline" onClick={() => onClose(null)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
