import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import { uniqueOrderKeyBetween } from "@t3tools/shared/orderKey";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { randomUUID } from "../../lib/utils";
import {
  organizationViewAtom,
  legacyOrganizationAtom,
} from "../../state/sidebarOrganization/state";
import { useOrganizationActions } from "../../state/sidebarOrganization/useOrganizationActions";
import { useOrganizationSync } from "../../state/sidebarOrganization/useOrganizationSync";

const COLLAPSE_KEY = "t3code:rakesh:sidebar-collapse:v1";
const EMPTY_COLLAPSE: Readonly<Record<string, boolean>> = {};
const CollapseSchema = Schema.Record(Schema.String, Schema.Boolean);

export function useSidebarSections(_activeKeys: readonly string[]) {
  useOrganizationSync();
  const view = useAtomValue(organizationViewAtom);
  const legacy = useAtomValue(legacyOrganizationAtom);
  const actions = useOrganizationActions();
  const [collapse, setCollapse] = useLocalStorage(COLLAPSE_KEY, EMPTY_COLLAPSE, CollapseSchema);
  const state = {
    ...view.sections,
    sections: view.sections.sections.map((section) => ({
      ...section,
      collapsed:
        collapse[`${actions.primary}:${section.id}`] ??
        legacy.sections.sections.find((old) => old.id === section.id)?.collapsed ??
        false,
    })),
    chatsCollapsed: collapse[`${actions.primary}:chats`] ?? legacy.sections.chatsCollapsed,
  };
  const assign = (threadKey: string, sectionId: string | null, orderKey: string | null = null) => {
    if (sectionId !== null && actions.primary === null) return Promise.resolve(false);
    return actions.mutate({
      type: "thread.place",
      threadKey,
      placement:
        sectionId === null || actions.primary === null
          ? null
          : {
              collectionEnvironmentId: actions.primary,
              sectionId,
              orderKey,
            },
    });
  };
  return {
    state,
    canManage: actions.canManage,
    canChangeThread: actions.canChangeThread,
    add: async (name: string) => {
      const id = randomUUID();
      return (await actions.mutate({ type: "section.create", id, name })) ? id : null;
    },
    rename: (id: string, name: string) => actions.mutate({ type: "section.rename", id, name }),
    remove: (id: string) => actions.mutate({ type: "section.delete", id }),
    move: (id: string, delta: -1 | 1) => {
      const ids = state.sections.map((s) => s.id);
      const index = ids.indexOf(id);
      if (index < 0 || index + delta < 0 || index + delta >= ids.length) return;
      [ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!];
      void actions.mutate({ type: "section.reorder", sectionIds: ids });
    },
    toggle: (id: string | "chats") =>
      setCollapse((current) => ({
        ...current,
        [`${actions.primary}:${id}`]: !(id === "chats"
          ? state.chatsCollapsed
          : state.sections.find((s) => s.id === id)?.collapsed),
      })),
    assign: (threadKey: string, sectionId: string | null, _loadedThreadKeys?: readonly string[]) =>
      assign(threadKey, sectionId),
    place: (
      threadKey: string,
      sectionId: string | null,
      orderedKeys: readonly string[],
      _loadedThreadKeys: readonly string[],
    ) => {
      if (sectionId === null) {
        void assign(threadKey, null);
        return;
      }
      const siblings = orderedKeys.filter(
        (key) => key === threadKey || state.assignments[key] === sectionId,
      );
      const index = siblings.indexOf(threadKey);
      const before =
        index > 0 ? (view.threads[siblings[index - 1]!]?.placement?.orderKey ?? null) : null;
      const after =
        index >= 0 && index + 1 < siblings.length
          ? (view.threads[siblings[index + 1]!]?.placement?.orderKey ?? null)
          : null;
      const rank = uniqueOrderKeyBetween(before, after, randomUUID());
      void assign(threadKey, sectionId, rank);
    },
  };
}
