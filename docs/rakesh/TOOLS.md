# Sections and notes

The sidebar and T3 tools use the same saved organization state. Connect your
browsers and devices to the main T3 server to use its shared section collection.
Sections can group chats across projects and linked machines. A chat keeps its
section while it appears in Pinned, Working, Snoozed, or Settled. Deleting a
section returns its chats to Chats without deleting conversations.

Ask an agent to add a note, put a chat in a section, or manage the section list.
The tools are:

| Tool                | Actions                                               |
| ------------------- | ----------------------------------------------------- |
| `t3_sections`       | List, create, rename, reorder, delete sections        |
| `t3_thread_section` | Read placement; move to a section or `null` for Chats |
| `t3_thread_note`    | Read, set, clear the full note                        |

Use the main server as `environmentId` for `t3_sections`. For chat tools,
`environmentId` selects the chat's owning machine; `collectionEnvironmentId`
selects the main server when placing a linked chat in one of its sections.
Omit `threadId` to act on the calling chat. Notes keep the 500-character limit,
100-character sidebar preview, and full hover text.

Permissions follow the existing tools: note and placement writes use thread
write checks; section changes require Full Access in normal/default interaction
mode. Read-only clients cannot write. Linked calls keep their existing access
and provenance restrictions. An offline machine's saved entries remain visible;
changes to it need a connection and an upgraded server. A placement read reports
`sectionExists: null` when its collection cannot be checked. Calls received through
a link may save a reference to the main collection without reverse credentials;
this grants no access to change that collection. The main sidebar resolves whether
the referenced section still exists.

On the first connection after upgrading, the app backs up and imports existing
browser notes, section IDs, names, assignments, and order. A later profile fills
missing values without replacing shared edits or restoring cleared notes and
deleted sections. The original browser keys remain intact. Collapse preferences
stay on the device.

For backups, retain `userdata/sidebar-organization.json` and
`userdata/sidebar-organization-imports/` on each server. The main server also
keeps last-known linked snapshots for offline display. These files are separate
from the chat database.
