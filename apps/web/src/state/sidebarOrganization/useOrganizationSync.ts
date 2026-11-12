import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { useContext, useEffect, useState, useSyncExternalStore } from "react";

import {
  EMPTY_THREAD_NOTES,
  THREAD_NOTES_STORAGE_KEY,
  ThreadNotesSchema,
} from "../../components/rakesh/threadNotes.logic";
import {
  decodeSidebarSectionsState,
  SIDEBAR_SECTIONS_STORAGE_KEY,
} from "../../components/sidebarSections/sidebarSections.logic";
import { subscribeLocalStorageKey, useLocalStorage } from "../../hooks/useLocalStorage";
import { randomUUID } from "../../lib/utils";
import { primaryEnvironmentIdAtom } from "../primaryEnvironment";
import { buildLegacyImport } from "./logic";
import { createOrganizationRetryQueue } from "./retry";
import {
  cacheOrganizationPeer,
  importOrganization,
  legacyOrganizationAtom,
  organizationSnapshotsAtom,
  writableOrganizationEnvironmentsAtom,
} from "./state";

const PROFILE_KEY = "t3code:rakesh:organization-profile:v1";
const decodeNotes = Schema.decodeUnknownOption(Schema.fromJsonString(ThreadNotesSchema));
const readRaw = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
function legacySource<A>(key: string, decode: (raw: string | null) => A) {
  let previous: string | null = null;
  let value = decode(null);
  return {
    subscribe: (onChange: () => void) => subscribeLocalStorageKey(key, onChange),
    snapshot: () => {
      const raw = readRaw(key);
      if (raw !== previous) {
        previous = raw;
        value = decode(raw);
      }
      return value;
    },
  };
}
const sectionsSource = legacySource(SIDEBAR_SECTIONS_STORAGE_KEY, decodeSidebarSectionsState);
const notesSource = legacySource(THREAD_NOTES_STORAGE_KEY, (raw) =>
  raw === null ? EMPTY_THREAD_NOTES : Option.getOrElse(decodeNotes(raw), () => EMPTY_THREAD_NOTES),
);

export function useOrganizationSync() {
  const registry = useContext(RegistryContext);
  const primary = useAtomValue(primaryEnvironmentIdAtom);
  const snapshots = useAtomValue(organizationSnapshotsAtom);
  const writable = useAtomValue(writableOrganizationEnvironmentsAtom);
  const sections = useSyncExternalStore(
    sectionsSource.subscribe,
    sectionsSource.snapshot,
    sectionsSource.snapshot,
  );
  const notes = useSyncExternalStore(
    notesSource.subscribe,
    notesSource.snapshot,
    notesSource.snapshot,
  );
  const [profileId, setProfileId] = useLocalStorage(PROFILE_KEY, "", Schema.String);
  const canImportPrimary = useAtomValue(
    importOrganization.permissionAtom(
      primary,
      buildLegacyImport("permission", primary ?? "", sections, notes),
    ),
  );
  const [queue] = useState(() => createOrganizationRetryQueue());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- own retry timers only while the sidebar is mounted
  useEffect(() => {
    queue.start();
    return () => queue.dispose();
  }, [queue]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keep the migration source in sync with browser storage events from older windows
  useEffect(() => {
    registry.set(legacyOrganizationAtom, { sections, notes });
  }, [registry, sections, notes]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- retain the original browser payload before assigning this profile its durable import receipt
  useEffect(() => {
    if (profileId !== "") return;
    const id = randomUUID();
    try {
      window.localStorage.setItem(
        `t3code:rakesh:organization-backup:v1:${id}`,
        JSON.stringify({
          sections: window.localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY),
          notes: window.localStorage.getItem(THREAD_NOTES_STORAGE_KEY),
        }),
      );
      setProfileId(id);
    } catch {
      // The original keys remain untouched; a later mount can retry after storage is available.
    }
  }, [profileId, setProfileId]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- migrate browser data and persist last-known peer snapshots as external server state changes
  useEffect(() => {
    if (primary === null || profileId === "") return;
    const root = snapshots.get(primary);
    if (root === undefined) return;
    const sourceId = `profile:${profileId}:${primary}`;
    const legacy = buildLegacyImport(sourceId, primary, sections, notes);
    if (!root.importedSources.includes(sourceId)) {
      if (canImportPrimary)
        queue.run(sourceId, (attempt) =>
          runAtomCommand(
            registry,
            importOrganization,
            { environmentId: primary, input: legacy },
            { label: "Import sidebar notes and sections", reportFailure: attempt === 0 },
          ),
        );
      return;
    }
    for (const [environmentId, snapshot] of snapshots) {
      if (environmentId === primary) continue;
      const prefix = `${environmentId}:`;
      const input = {
        sourceId: `shared:${primary}:${environmentId}:${root.importedSources.filter((source) => source.startsWith("profile:")).length}`,
        sections: [],
        threads: Object.fromEntries(
          Object.entries(root.threads).filter(([key]) => key.startsWith(prefix)),
        ),
      };
      if (!snapshot.importedSources.includes(input.sourceId)) {
        if (writable.has(environmentId))
          queue.run(input.sourceId, (attempt) =>
            runAtomCommand(
              registry,
              importOrganization,
              { environmentId, input },
              { label: "Import linked chat notes and placements", reportFailure: attempt === 0 },
            ),
          );
        continue;
      }
      if ((root.cachedEnvironments[environmentId]?.revision ?? -1) >= snapshot.threadRevision)
        continue;
      const cacheInput = {
        environmentId,
        revision: snapshot.threadRevision,
        threads: Object.fromEntries(
          Object.entries(snapshot.threads).filter(([key]) => key.startsWith(prefix)),
        ),
      };
      if (writable.has(primary))
        queue.run(`cache:${environmentId}:${snapshot.threadRevision}`, () =>
          runAtomCommand(
            registry,
            cacheOrganizationPeer,
            { environmentId: primary, input: cacheInput },
            { label: "Save linked sidebar snapshot", reportFailure: false },
          ),
        );
    }
  }, [registry, primary, profileId, snapshots, sections, notes, writable, canImportPrimary, queue]);
}
