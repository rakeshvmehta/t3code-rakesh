import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  EMPTY_SIDEBAR_ORGANIZATION,
  type SidebarOrganizationState,
} from "@t3tools/contracts/sidebarOrganization";
import {
  applySidebarOrganizationMutation,
  applySidebarOrganizationImport,
  placementForCollection,
} from "./sidebarOrganization.js";

const mac = { collectionEnvironmentId: "mac", sectionId: "work", orderKey: "a" };
const pc = { collectionEnvironmentId: "pc", sectionId: "work", orderKey: "b" };
const legacy: SidebarOrganizationState = {
  ...EMPTY_SIDEBAR_ORGANIZATION,
  sections: [{ id: "work", name: "Work" }],
  threads: { "mac:chat": { note: "Keep", placement: mac } },
};
const mutate = applySidebarOrganizationMutation;

describe("collection-scoped placement", () => {
  it("imports a second legacy collection without overwriting the first", () => {
    const imported = applySidebarOrganizationImport(legacy, {
      sourceId: "pc-profile",
      sections: [],
      threads: { "mac:chat": { placement: pc } },
    });
    expect(placementForCollection(imported.threads["mac:chat"], "mac")).toEqual(mac);
    expect(placementForCollection(imported.threads["mac:chat"], "pc")).toEqual(pc);
    const cleared = applySidebarOrganizationImport(
      { ...legacy, threads: { "mac:chat": { placement: null } } },
      {
        sourceId: "stale-profile",
        sections: [],
        threads: { "mac:chat": { placement: mac } },
      },
    );
    expect(placementForCollection(cleared.threads["mac:chat"], "mac")).toBeNull();
    const importedAgain = applySidebarOrganizationImport(cleared, {
      sourceId: "another-stale-profile",
      sections: [],
      threads: { "mac:chat": { placement: mac } },
    });
    expect(placementForCollection(importedAgain.threads["mac:chat"], "mac")).toBeNull();
  });
  it.effect("preserves both collections across move, clear, stale import and reorder", () =>
    Effect.gen(function* () {
      const moved = yield* mutate(legacy, {
        type: "thread.placeInCollection",
        threadKey: "mac:chat",
        collectionEnvironmentId: "pc",
        placement: pc,
      });
      expect(placementForCollection(moved.threads["mac:chat"], "mac")).toEqual(mac);
      expect(placementForCollection(moved.threads["mac:chat"], "pc")).toEqual(pc);
      const cleared = yield* mutate(moved, {
        type: "thread.placeInCollection",
        threadKey: "mac:chat",
        collectionEnvironmentId: "mac",
        placement: null,
      });
      const imported = applySidebarOrganizationImport(cleared, {
        sourceId: "stale",
        sections: legacy.sections,
        threads: { "mac:chat": { placement: mac, placements: { mac, pc } } },
      });
      expect(placementForCollection(imported.threads["mac:chat"], "mac")).toBeNull();
      expect(placementForCollection(imported.threads["mac:chat"], "pc")).toEqual(pc);
      const reordered = yield* mutate(imported, {
        type: "thread.placeInCollection",
        threadKey: "mac:chat",
        collectionEnvironmentId: "pc",
        placement: { ...pc, orderKey: "c" },
      });
      expect(placementForCollection(reordered.threads["mac:chat"], "mac")).toBeNull();
      expect(placementForCollection(reordered.threads["mac:chat"], "pc")?.orderKey).toBe("c");
      expect(reordered.threads["mac:chat"]?.note).toBe("Keep");
    }),
  );
  it.effect("deletes only the owning collection's placement when section IDs collide", () =>
    Effect.gen(function* () {
      const moved = yield* mutate(legacy, {
        type: "thread.placeInCollection",
        threadKey: "mac:chat",
        collectionEnvironmentId: "pc",
        placement: pc,
      });
      const deleted = yield* mutate(moved, {
        type: "section.delete",
        id: "work",
        collectionEnvironmentId: "mac",
      });
      expect(placementForCollection(deleted.threads["mac:chat"], "mac")).toBeNull();
      expect(placementForCollection(deleted.threads["mac:chat"], "pc")).toEqual(pc);
    }),
  );
  it.effect("scopes an old client's move and rejects its ambiguous clear", () =>
    Effect.gen(function* () {
      const moved = yield* mutate(legacy, {
        type: "thread.placeInCollection",
        threadKey: "mac:chat",
        collectionEnvironmentId: "pc",
        placement: pc,
      });
      const changed = yield* mutate(moved, {
        type: "thread.place",
        threadKey: "mac:chat",
        placement: { ...mac, orderKey: "d" },
      });
      const error = yield* Effect.flip(
        mutate(changed, {
          type: "thread.place",
          threadKey: "mac:chat",
          placement: null,
        }),
      );
      expect(error.reason).toBe("collection_required");
      expect(placementForCollection(changed.threads["mac:chat"], "mac")?.orderKey).toBe("d");
      expect(placementForCollection(changed.threads["mac:chat"], "pc")).toEqual(pc);
    }),
  );
  it("preserves an existing legacy assignment when another profile imports scoped placements", () => {
    const incoming = { ...mac, sectionId: "stale" };
    const imported = applySidebarOrganizationImport(legacy, {
      sourceId: "peer",
      sections: [],
      threads: { "mac:chat": { placements: { mac: incoming, pc } } },
    });
    expect(placementForCollection(imported.threads["mac:chat"], "mac")).toEqual(mac);
    expect(placementForCollection(imported.threads["mac:chat"], "pc")).toEqual(pc);
  });
  it.effect("rejects a placement addressed to a different collection", () =>
    Effect.gen(function* () {
      const result = yield* Effect.flip(
        applySidebarOrganizationMutation(legacy, {
          type: "thread.placeInCollection",
          threadKey: "mac:chat",
          collectionEnvironmentId: "mac",
          placement: pc,
        }),
      );
      expect(result.reason).toBe("wrong_environment");
    }),
  );
});
