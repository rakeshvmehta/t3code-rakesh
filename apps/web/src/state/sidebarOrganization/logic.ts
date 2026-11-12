import type {
  SidebarOrganizationImport,
  SidebarOrganizationState,
  SidebarThreadOrganization,
} from "@t3tools/contracts/sidebarOrganization";
import { spreadOrderKeys } from "@t3tools/shared/orderKey";
import { setThreadNote, type ThreadNotes } from "../../components/rakesh/threadNotes.logic";
import type { SidebarSectionsState } from "../../components/sidebarSections/sidebarSections.logic";

export function threadEnvironmentForKey(
  threadKey: string,
  environments: readonly string[],
): string | null {
  return (
    [...environments]
      .sort((a, b) => b.length - a.length)
      .find((id) => threadKey.startsWith(`${id}:`)) ?? null
  );
}

export function buildLegacyImport(
  sourceId: string,
  collectionEnvironmentId: string,
  sections: SidebarSectionsState,
  notes: ThreadNotes,
): SidebarOrganizationImport {
  const threads: Record<string, SidebarThreadOrganization> = {};
  for (const [key, note] of Object.entries(notes))
    threads[key] = { note: setThreadNote({}, key, note)[key] ?? null };
  const orderedKeys = [
    ...new Set([...(sections.threadOrder ?? []), ...Object.keys(sections.assignments)]),
  ];
  const ranks = spreadOrderKeys(orderedKeys.length);
  const known = new Set(sections.sections.map((s) => s.id));
  orderedKeys.forEach((key, index) => {
    const sectionId = sections.assignments[key];
    if (sectionId !== undefined && known.has(sectionId))
      threads[key] = {
        ...threads[key],
        placement: {
          collectionEnvironmentId,
          sectionId,
          orderKey: ranks[index]!,
        },
      };
  });
  return { sourceId, sections: sections.sections.map(({ id, name }) => ({ id, name })), threads };
}

export function composeOrganizationView(
  collectionEnvironmentId: string,
  root: SidebarOrganizationState | null,
  live: ReadonlyMap<string, SidebarOrganizationState>,
  legacy: SidebarOrganizationImport,
): {
  readonly sections: SidebarSectionsState;
  readonly notes: ThreadNotes;
  readonly threads: Readonly<Record<string, SidebarThreadOrganization>>;
} {
  const threads = { ...legacy.threads };
  const merge = (key: string, record: SidebarThreadOrganization) => {
    threads[key] = { ...threads[key], ...record };
  };
  for (const [key, record] of Object.entries(root?.threads ?? {})) merge(key, record);
  for (const [environmentId, snapshot] of Object.entries(root?.cachedEnvironments ?? {})) {
    if (environmentId === collectionEnvironmentId) continue;
    for (const [key, record] of Object.entries(snapshot.threads))
      if (key.startsWith(`${environmentId}:`)) merge(key, record);
  }
  for (const [environmentId, snapshot] of live) {
    if (environmentId === collectionEnvironmentId) continue;
    for (const [key, record] of Object.entries(snapshot.threads))
      if (key.startsWith(`${environmentId}:`)) merge(key, record);
  }
  const sections = [...(root?.sections ?? [])];
  const known = new Set([...(root?.deletedSectionIds ?? []), ...sections.map((s) => s.id)]);
  for (const section of legacy.sections)
    if (!known.has(section.id)) {
      sections.push(section);
      known.add(section.id);
    }
  const activeSectionIds = new Set(sections.map((s) => s.id));
  const assignments: Record<string, string> = {};
  const notes: Record<string, string> = {};
  const ranked: Array<{ key: string; orderKey: string | null }> = [];
  for (const [key, record] of Object.entries(threads)) {
    if (record.note) notes[key] = record.note;
    const placement = record.placement;
    if (
      placement?.collectionEnvironmentId === collectionEnvironmentId &&
      activeSectionIds.has(placement.sectionId)
    ) {
      assignments[key] = placement.sectionId;
      ranked.push({ key, orderKey: placement.orderKey });
    }
  }
  ranked.sort((a, b) => {
    const left = a.orderKey ?? "\uffff";
    const right = b.orderKey ?? "\uffff";
    return left < right ? -1 : left > right ? 1 : a.key.localeCompare(b.key);
  });
  return {
    threads,
    notes,
    sections: {
      sections: sections.map((s) => ({ ...s, collapsed: false })),
      assignments,
      chatsCollapsed: false,
      threadOrder: ranked.map((r) => r.key),
    },
  };
}
