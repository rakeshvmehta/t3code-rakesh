import {
  SidebarOrganizationError,
  type SidebarOrganizationImport,
  type SidebarOrganizationMutation,
  type SidebarOrganizationState,
} from "@t3tools/contracts/sidebarOrganization";
import * as Effect from "effect/Effect";

export const applySidebarOrganizationMutation = Effect.fn("applySidebarOrganizationMutation")(
  function* (current: SidebarOrganizationState, input: SidebarOrganizationMutation) {
    let next = current;
    switch (input.type) {
      case "section.create": {
        if (
          current.sections.some((s) => s.id === input.id) ||
          current.deletedSectionIds.includes(input.id)
        )
          return yield* new SidebarOrganizationError({ reason: "section_conflict" });
        const name = input.name.trim();
        if (!name) return yield* new SidebarOrganizationError({ reason: "invalid_state" });
        next = { ...current, sections: [...current.sections, { id: input.id, name }] };
        break;
      }
      case "section.rename": {
        if (!current.sections.some((s) => s.id === input.id))
          return yield* new SidebarOrganizationError({ reason: "section_not_found" });
        const name = input.name.trim();
        if (!name) return yield* new SidebarOrganizationError({ reason: "invalid_state" });
        next = {
          ...current,
          sections: current.sections.map((s) => (s.id === input.id ? { ...s, name } : s)),
        };
        break;
      }
      case "section.delete": {
        if (!current.sections.some((s) => s.id === input.id))
          return yield* new SidebarOrganizationError({ reason: "section_not_found" });
        next = {
          ...current,
          sections: current.sections.filter((s) => s.id !== input.id),
          deletedSectionIds: [...current.deletedSectionIds, input.id],
          threads: Object.fromEntries(
            Object.entries(current.threads).map(([key, record]) => [
              key,
              record.placement?.sectionId === input.id ? { ...record, placement: null } : record,
            ]),
          ),
        };
        break;
      }
      case "section.reorder": {
        const byId = new Map(current.sections.map((s) => [s.id, s]));
        if (
          input.sectionIds.length !== byId.size ||
          new Set(input.sectionIds).size !== byId.size ||
          input.sectionIds.some((id) => !byId.has(id))
        )
          return yield* new SidebarOrganizationError({ reason: "invalid_order" });
        next = { ...current, sections: input.sectionIds.map((id) => byId.get(id)!) };
        break;
      }
      case "thread.note":
        next = {
          ...current,
          threads: {
            ...current.threads,
            [input.threadKey]: {
              ...current.threads[input.threadKey],
              note: input.note?.trim() || null,
            },
          },
        };
        break;
      case "thread.place":
        next = {
          ...current,
          threads: {
            ...current.threads,
            [input.threadKey]: {
              ...current.threads[input.threadKey],
              placement: input.placement,
            },
          },
        };
        break;
    }
    return {
      ...next,
      revision: current.revision + 1,
      threadRevision: current.threadRevision + (input.type.startsWith("thread.") ? 1 : 0),
    };
  },
);

export function applySidebarOrganizationImport(
  current: SidebarOrganizationState,
  input: SidebarOrganizationImport,
): SidebarOrganizationState {
  if (current.importedSources.includes(input.sourceId)) return current;
  const sections = [...current.sections];
  const known = new Set([...current.deletedSectionIds, ...sections.map((s) => s.id)]);
  for (const section of input.sections) {
    const name = section.name.trim();
    if (!known.has(section.id) && name) {
      sections.push({ ...section, name });
      known.add(section.id);
    }
  }
  const threads = { ...current.threads };
  for (const [key, record] of Object.entries(input.threads)) {
    const existing = threads[key] ?? {};
    const placement =
      record.placement && current.deletedSectionIds.includes(record.placement.sectionId)
        ? null
        : record.placement;
    threads[key] = {
      ...record,
      ...(placement === undefined ? {} : { placement }),
      ...existing,
    };
  }
  return {
    ...current,
    revision: current.revision + 1,
    sections,
    threads,
    importedSources: [...current.importedSources, input.sourceId],
    threadRevision: current.threadRevision + (Object.keys(input.threads).length > 0 ? 1 : 0),
  };
}
