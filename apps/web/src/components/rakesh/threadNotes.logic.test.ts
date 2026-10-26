import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_THREAD_NOTES,
  THREAD_NOTE_MAX_LENGTH,
  isThreadNoteMenuId,
  removeThreadNotes,
  setThreadNote,
  withThreadNoteMenuItems,
} from "./threadNotes.logic.ts";

describe("setThreadNote", () => {
  it("stores a trimmed note", () => {
    expect(setThreadNote(EMPTY_THREAD_NOTES, "env:t1", "  blocked on staging \n")).toEqual({
      "env:t1": "blocked on staging",
    });
  });

  it("keeps line breaks inside the note", () => {
    expect(setThreadNote(EMPTY_THREAD_NOTES, "env:t1", "line one\nline two")["env:t1"]).toBe(
      "line one\nline two",
    );
  });

  it("clears the note when the text is blank", () => {
    const notes = setThreadNote(EMPTY_THREAD_NOTES, "env:t1", "x");
    expect(setThreadNote(notes, "env:t1", "   ")).toEqual({});
  });

  it("cuts notes at the cap", () => {
    const note = setThreadNote(EMPTY_THREAD_NOTES, "env:t1", "a".repeat(600))["env:t1"];
    expect(note).toHaveLength(THREAD_NOTE_MAX_LENGTH);
  });

  it("returns the same object when nothing changes", () => {
    const notes = setThreadNote(EMPTY_THREAD_NOTES, "env:t1", "x");
    expect(setThreadNote(notes, "env:t1", "x")).toBe(notes);
    expect(setThreadNote(notes, "env:t2", "")).toBe(notes);
  });
});

describe("removeThreadNotes", () => {
  it("drops only the given keys", () => {
    const notes = { "env:t1": "a", "env:t2": "b", "env:t3": "c" };
    expect(removeThreadNotes(notes, new Set(["env:t1", "env:t3", "env:missing"]))).toEqual({
      "env:t2": "b",
    });
  });

  it("returns the same object when no key has a note", () => {
    const notes = { "env:t1": "a" };
    expect(removeThreadNotes(notes, ["env:t2"])).toBe(notes);
  });
});

describe("withThreadNoteMenuItems", () => {
  const items = [
    { id: "pin", label: "Pin thread" },
    { id: "rename", label: "Rename thread" },
    { id: "delete", label: "Delete" },
  ];

  it("offers Add note right after Rename when there is no note", () => {
    expect(withThreadNoteMenuItems(items, false).map((item) => item.label)).toEqual([
      "Pin thread",
      "Rename thread",
      "Add note…",
      "Delete",
    ]);
  });

  it("offers Edit and Clear when a note exists", () => {
    expect(withThreadNoteMenuItems(items, true).map((item) => item.label)).toEqual([
      "Pin thread",
      "Rename thread",
      "Edit note…",
      "Clear note",
      "Delete",
    ]);
  });

  it("appends the items when there is no Rename entry", () => {
    expect(withThreadNoteMenuItems([{ id: "delete", label: "Delete" }], false).at(-1)?.id).toBe(
      "rakesh-note:edit",
    );
  });
});

describe("isThreadNoteMenuId", () => {
  it("recognises only the note actions", () => {
    expect(isThreadNoteMenuId("rakesh-note:edit")).toBe(true);
    expect(isThreadNoteMenuId("rakesh-note:clear")).toBe(true);
    expect(isThreadNoteMenuId("rename")).toBe(false);
  });
});
