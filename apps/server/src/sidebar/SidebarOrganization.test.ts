import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { EnvironmentId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as SidebarOrganization from "./SidebarOrganization.ts";

const testLayer = SidebarOrganization.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest("/workspace", { prefix: "t3-sidebar-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

describe("shared sidebar persistence", () => {
  it.effect("preserves independent concurrent note edits and section placement", () =>
    Effect.gen(function* () {
      const store = yield* SidebarOrganization.SidebarOrganization;
      yield* store.mutate({ type: "section.create", id: "work", name: "Work" });
      yield* Effect.all(
        [
          store.mutate({ type: "thread.note", threadKey: "local:one", note: "First" }),
          store.mutate({ type: "thread.note", threadKey: "peer:one", note: "Second" }),
          store.mutate({
            type: "thread.place",
            threadKey: "local:one",
            placement: {
              collectionEnvironmentId: "local",
              sectionId: "work",
              orderKey: "a0",
            },
          }),
        ],
        { concurrency: "unbounded" },
      );
      const state = yield* store.snapshot;
      assert.equal(state.threads["local:one"]?.note, "First");
      assert.equal(state.threads["peer:one"]?.note, "Second");
      assert.equal(state.threads["local:one"]?.placement?.sectionId, "work");
      assert.equal(state.revision, 4);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("does not resurrect a cleared note or deleted section from a stale profile", () =>
    Effect.gen(function* () {
      const store = yield* SidebarOrganization.SidebarOrganization;
      const legacy = {
        sections: [{ id: "old", name: "Old" }],
        threads: {
          "local:old": {
            note: "Old note",
            placement: {
              collectionEnvironmentId: "local",
              sectionId: "old",
              orderKey: "a0",
            },
          },
        },
      };
      yield* store.importLegacy({ sourceId: "first-profile", ...legacy });
      yield* store.mutate({ type: "thread.note", threadKey: "local:old", note: null });
      yield* store.mutate({ type: "section.delete", id: "old" });
      yield* store.importLegacy({ sourceId: "second-profile", ...legacy });
      const state = yield* store.snapshot;
      assert.equal(state.threads["local:old"]?.note, null);
      assert.deepEqual(state.sections, []);
      assert.equal(state.threads["local:old"]?.placement, null);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("backs up an imported profile and stores a decodable durable snapshot", () =>
    Effect.gen(function* () {
      const store = yield* SidebarOrganization.SidebarOrganization;
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* store.importLegacy({
        sourceId: "profile",
        sections: [],
        threads: {
          "peer:offline": { note: "Keep offline data" },
        },
      });
      const raw = JSON.parse(
        yield* fs.readFileString(path.join(config.stateDir, "sidebar-organization.json")),
      );
      assert.equal(raw.threads["peer:offline"].note, "Keep offline data");
      const restarted = yield* SidebarOrganization.SidebarOrganization.pipe(
        Effect.flatMap((fresh) => fresh.snapshot),
        Effect.provide(SidebarOrganization.layer),
      );
      assert.equal(restarted.threads["peer:offline"]?.note, "Keep offline data");
      const backups = yield* fs.readDirectory(
        path.join(config.stateDir, "sidebar-organization-imports"),
      );
      assert.equal(backups.length, 1);
      yield* store.importLegacy({ sourceId: "profile", sections: [], threads: {} });
      assert.equal((yield* store.snapshot).threads["peer:offline"]?.note, "Keep offline data");
      assert.equal(
        (yield* fs.readDirectory(path.join(config.stateDir, "sidebar-organization-imports")))
          .length,
        1,
      );
    }).pipe(Effect.provide(testLayer)),
  );
  it.effect(
    "keeps corrupt data intact and exposes a feature error without failing service construction",
    () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const file = path.join(config.stateDir, "sidebar-organization.json");
        yield* fs.writeFileString(file, "{broken");
        yield* Effect.gen(function* () {
          const store = yield* SidebarOrganization.SidebarOrganization;
          const error = yield* store.snapshot.pipe(Effect.flip);
          assert.equal(error.reason, "invalid_state");
          assert.equal(yield* fs.readFileString(file), "{broken");
        }).pipe(Effect.provide(SidebarOrganization.layer));
      }).pipe(
        Effect.provide(
          ServerConfig.layerTest("/workspace", { prefix: "t3-sidebar-corrupt-" }).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
      ),
  );

  it.effect("retains the newest peer snapshot for offline display and rejects foreign keys", () =>
    Effect.gen(function* () {
      const store = yield* SidebarOrganization.SidebarOrganization;
      yield* store.cachePeer({
        environmentId: EnvironmentId.make("peer"),
        revision: 2,
        threads: { "peer:thread": { note: null } },
      });
      yield* store.cachePeer({
        environmentId: EnvironmentId.make("peer"),
        revision: 1,
        threads: { "peer:thread": { note: "Old" } },
      });
      expect(
        (yield* store.snapshot).cachedEnvironments["peer"]?.threads["peer:thread"]?.note,
      ).toBeNull();
      const invalid = yield* store
        .cachePeer({
          environmentId: EnvironmentId.make("peer"),
          revision: 3,
          threads: { "other:thread": { note: "Wrong owner" } },
        })
        .pipe(Effect.flip);
      expect(invalid.reason).toBe("wrong_environment");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("never emits an older queued snapshot after the subscription's initial state", () =>
    Effect.gen(function* () {
      const store = yield* SidebarOrganization.SidebarOrganization;
      const held = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const first = yield* Deferred.make<void>();
      const writer = yield* store
        .mutate(
          { type: "thread.note", threadKey: "local:one", note: "One" },
          Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release))),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(held);
      const watch = yield* store.changes.pipe(
        Stream.tap(() => Deferred.succeed(first, undefined)),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(writer);
      yield* Deferred.await(first);
      yield* store.mutate({ type: "thread.note", threadKey: "local:two", note: "Two" });
      const snapshots = yield* Fiber.join(watch);
      expect(snapshots.map((s) => s.revision)).toEqual([1, 2]);
    }).pipe(Effect.provide(testLayer)),
  );
  it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32" || process.getuid?.() === 0)(
    "leaves the durable and in-memory state unchanged when a write fails",
    () =>
      Effect.gen(function* () {
        const store = yield* SidebarOrganization.SidebarOrganization;
        const config = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* store.mutate({ type: "thread.note", threadKey: "local:one", note: "Keep" });
        yield* fs.chmod(config.stateDir, 0o500);
        const error = yield* store
          .mutate({ type: "thread.note", threadKey: "local:one", note: "Failed" })
          .pipe(Effect.flip, Effect.ensuring(fs.chmod(config.stateDir, 0o700).pipe(Effect.orDie)));
        expect(error.reason).toBe("storage_unavailable");
        expect((yield* store.snapshot).threads["local:one"]?.note).toBe("Keep");
        const restarted = yield* SidebarOrganization.SidebarOrganization.pipe(
          Effect.flatMap((fresh) => fresh.snapshot),
          Effect.provide(SidebarOrganization.layer),
        );
        expect(restarted.threads["local:one"]?.note).toBe("Keep");
      }).pipe(Effect.provide(testLayer)),
  );
});
