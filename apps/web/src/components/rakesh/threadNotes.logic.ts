import type { ContextMenuItem } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

// The old browser key remains a migration source for shared thread reminders.
export const THREAD_NOTES_STORAGE_KEY = "t3code:rakesh:thread-notes:v1";

export const THREAD_NOTE_MAX_LENGTH = 500;

export type ThreadNotes = Readonly<Record<string, string>>;

export const EMPTY_THREAD_NOTES: ThreadNotes = {};

export const ThreadNotesSchema = Schema.Record(Schema.String, Schema.String);

export function threadNotePreview(note: string | undefined): string | null {
  const text = note?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const characters = Array.from(text);
  return characters.length > 100 ? `${characters.slice(0, 100).join("").trimEnd()}…` : text;
}

// A blank note clears it; anything past the cap is cut.
export function setThreadNote(notes: ThreadNotes, threadKey: string, text: string): ThreadNotes {
  const note = text.trim().slice(0, THREAD_NOTE_MAX_LENGTH);
  if (note.length === 0) return removeThreadNotes(notes, [threadKey]);
  if (notes[threadKey] === note) return notes;
  return { ...notes, [threadKey]: note };
}

export function removeThreadNotes(notes: ThreadNotes, threadKeys: Iterable<string>): ThreadNotes {
  const doomed = [...threadKeys].filter((threadKey) => threadKey in notes);
  if (doomed.length === 0) return notes;
  const kept = { ...notes };
  for (const threadKey of doomed) delete kept[threadKey];
  return kept;
}

export type ThreadNoteMenuId = "rakesh-note:edit" | "rakesh-note:clear";

export function isThreadNoteMenuId(id: string): id is ThreadNoteMenuId {
  return id === "rakesh-note:edit" || id === "rakesh-note:clear";
}

// Adds the note actions right after upstream's "Rename thread".
export function withThreadNoteMenuItems<T extends string>(
  items: ReadonlyArray<ContextMenuItem<T>>,
  hasNote: boolean,
): ReadonlyArray<ContextMenuItem<T | ThreadNoteMenuId>> {
  const noteItems: ContextMenuItem<ThreadNoteMenuId>[] = [
    { id: "rakesh-note:edit", label: hasNote ? "Edit note…" : "Add note…", icon: "pencil" },
  ];
  if (hasNote) noteItems.push({ id: "rakesh-note:clear", label: "Clear note" });
  const renameIndex = items.findIndex((item) => item.id === "rename");
  const at = renameIndex === -1 ? items.length : renameIndex + 1;
  return [...items.slice(0, at), ...noteItems, ...items.slice(at)];
}
