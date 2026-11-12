import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { type EnvironmentId } from "@t3tools/contracts";
import type { SidebarOrganizationMutation } from "@t3tools/contracts/sidebarOrganization";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { useContext } from "react";

import { environmentCatalog } from "../../connection/catalog";
import { primaryEnvironmentIdAtom } from "../primaryEnvironment";
import { threadEnvironmentForKey } from "./logic";
import {
  mutateOrganization,
  organizationSnapshotsAtom,
  writableOrganizationEnvironmentsAtom,
} from "./state";

export function useOrganizationActions() {
  const registry = useContext(RegistryContext);
  const primary = useAtomValue(primaryEnvironmentIdAtom);
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const snapshots = useAtomValue(organizationSnapshotsAtom);
  const writable = useAtomValue(writableOrganizationEnvironmentsAtom);
  const canManage = useAtomValue(
    mutateOrganization.permissionAtom(primary, {
      type: "section.create",
      id: "permission",
      name: "Section",
    }),
  );
  const targetFor = (threadKey: string) =>
    threadEnvironmentForKey(threadKey, [...catalog.entries.keys()]) as EnvironmentId | null;
  const canChangeThread = (threadKey: string) => {
    const environmentId = targetFor(threadKey);
    return environmentId !== null && snapshots.has(environmentId) && writable.has(environmentId);
  };
  const mutate = async (input: SidebarOrganizationMutation) => {
    const environmentId =
      input.type === "thread.note" || input.type === "thread.place"
        ? targetFor(input.threadKey)
        : primary;
    if (environmentId === null || !snapshots.has(environmentId)) return false;
    const result = await runAtomCommand(
      registry,
      mutateOrganization,
      { environmentId, input },
      { label: "Update sidebar organization" },
    );
    return result._tag === "Success";
  };
  return {
    primary,
    canManage: primary !== null && snapshots.has(primary) && canManage,
    canChangeThread,
    mutate,
  };
}
