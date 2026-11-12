import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import type { SidebarOrganizationState } from "@t3tools/contracts/sidebarOrganization";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";

import { environmentCatalog } from "../../connection/catalog";
import { connectionAtomRuntime } from "../../connection/runtime";
import { getLocalStorageItem } from "../../hooks/useLocalStorage";
import {
  EMPTY_THREAD_NOTES,
  THREAD_NOTES_STORAGE_KEY,
  ThreadNotesSchema,
} from "../../components/rakesh/threadNotes.logic";
import {
  EMPTY_SIDEBAR_SECTIONS_STATE,
  SIDEBAR_SECTIONS_STORAGE_KEY,
  SidebarSectionsStateSchema,
} from "../../components/sidebarSections/sidebarSections.logic";
import { primaryEnvironmentIdAtom } from "../primaryEnvironment";
import { serverEnvironment } from "../server";
import { buildLegacyImport, composeOrganizationView } from "./logic";

const snapshots = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
  label: "sidebar-organization:watch",
  tag: WS_METHODS.sidebarWatch,
});
const savedSnapshot = Atom.family((_environmentId: EnvironmentId) =>
  Atom.make<SidebarOrganizationState | null>(null),
);
const onSuccess = (
  target: { environmentId: EnvironmentId },
  registry: AtomRegistry.AtomRegistry,
  result: SidebarOrganizationState,
) => Effect.sync(() => registry.set(savedSnapshot(target.environmentId), result));
export const mutateOrganization = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "sidebar-organization:mutate",
  tag: WS_METHODS.sidebarMutate,
  onSuccess,
});
export const importOrganization = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "sidebar-organization:import",
  tag: WS_METHODS.sidebarImport,
  onSuccess,
});
export const cacheOrganizationPeer = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "sidebar-organization:cache-peer",
  tag: WS_METHODS.sidebarCachePeer,
  onSuccess,
});

const organizationSnapshot = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): SidebarOrganizationState | null => {
    if (
      get(serverEnvironment.configValueAtom(environmentId))?.environment.capabilities
        .sidebarOrganization !== true
    )
      return null;
    const live = AsyncResult.getOrElse(get(snapshots({ environmentId, input: {} })), () => null);
    const saved = get(savedSnapshot(environmentId));
    return saved !== null && (live === null || saved.revision > live.revision) ? saved : live;
  }),
);

export const organizationSnapshotsAtom = Atom.make((get) => {
  const result = new Map<EnvironmentId, SidebarOrganizationState>();
  for (const id of get(environmentCatalog.catalogValueAtom).entries.keys()) {
    const snapshot = get(organizationSnapshot(id));
    if (snapshot !== null) result.set(id, snapshot);
  }
  return result;
});

function readLegacyOrganization() {
  try {
    return {
      sections:
        getLocalStorageItem(SIDEBAR_SECTIONS_STORAGE_KEY, SidebarSectionsStateSchema) ??
        EMPTY_SIDEBAR_SECTIONS_STATE,
      notes: getLocalStorageItem(THREAD_NOTES_STORAGE_KEY, ThreadNotesSchema) ?? EMPTY_THREAD_NOTES,
    };
  } catch {
    return { sections: EMPTY_SIDEBAR_SECTIONS_STATE, notes: EMPTY_THREAD_NOTES };
  }
}
export const writableOrganizationEnvironmentsAtom = Atom.make((get) => {
  const writable = new Set<EnvironmentId>();
  for (const id of get(environmentCatalog.catalogValueAtom).entries.keys()) {
    if (
      get(
        mutateOrganization.permissionAtom(id, {
          type: "thread.note",
          threadKey: `${id}:permission`,
          note: null,
        }),
      )
    )
      writable.add(id);
  }
  return writable;
});

export const legacyOrganizationAtom = Atom.make(readLegacyOrganization());

export const organizationViewAtom = Atom.make((get) => {
  const primary = get(primaryEnvironmentIdAtom) ?? "";
  const all = get(organizationSnapshotsAtom);
  const legacy = get(legacyOrganizationAtom);
  return composeOrganizationView(
    primary,
    primary === "" ? null : (all.get(primary as EnvironmentId) ?? null),
    all,
    buildLegacyImport("display", primary, legacy.sections, legacy.notes),
  );
});
export const threadOrganizationNote = Atom.family((threadKey: string) =>
  Atom.make((get) => get(organizationViewAtom).notes[threadKey]),
);
