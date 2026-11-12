import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as Config from "../../../config.ts";
import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Organization from "../../../sidebar/SidebarOrganization.ts";
import * as OrganizationApplication from "../../../sidebar/SidebarOrganizationApplication.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as Handlers from "./handlers.ts";
import * as SidebarMcpService from "../../SidebarMcpService.ts";
import { SidebarToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("local");
const threadId = ThreadId.make("caller");
const targetId = ThreadId.make("target");
const scope = (access?: "read-only" | "full-access"): McpInvocationContext.McpInvocationScope => ({
  environmentId,
  requestNamespace: "sidebar-test",
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
  thread:
    access === undefined
      ? {
          threadId,
          providerSessionId: "caller",
          providerInstanceId: ProviderInstanceId.make("codex"),
        }
      : undefined,
  client: access === undefined ? undefined : { sessionId: "client", label: "Test", access },
});
const defaultThreads = Layer.mock(ThreadManagement.ThreadManagementService)({
  getThreadShell: (id) => Effect.succeed(liveThreadShell(id)),
});
const dependencies = (
  threadLayer: Layer.Layer<ThreadManagement.ThreadManagementService> = defaultThreads,
) =>
  Layer.mergeAll(
    Organization.layer,
    ThreadCommandExecutor.layer,
    Layer.mock(Environment.ServerEnvironmentIdentity)({
      getEnvironmentId: Effect.succeed(environmentId),
    }),
    threadLayer,
  ).pipe(
    Layer.provideMerge(Config.layerTest("/workspace", { prefix: "sidebar-tools-" })),
    Layer.provideMerge(NodeServices.layer),
  );
const makeLayer = (
  threadLayer: Layer.Layer<ThreadManagement.ThreadManagementService> = defaultThreads,
) =>
  McpToolAccess.HandlersLayer.layer(Handlers.layer).pipe(
    Layer.provideMerge(SidebarMcpService.layer),
    Layer.provide(OrganizationApplication.layer),
    Layer.provideMerge(dependencies(threadLayer)),
    Layer.provide(NodeCrypto.layer),
  );

const layer = makeLayer();

it.effect("tools create a section, place a thread, and read/set/clear its full note", () =>
  Effect.gen(function* () {
    const toolkit = yield* SidebarToolkit;
    const created = yield* toolkit
      .handle("t3_sections", { action: "create", name: "Work" })
      .pipe(Stream.unwrap, Stream.runCollect);
    const result = created.at(-1)?.result;
    expect(result).toMatchObject({ sections: [{ name: "Work" }] });
    const store = yield* Organization.SidebarOrganization;
    const sectionId = (yield* store.snapshot).sections[0]!.id;
    yield* toolkit
      .handle("t3_thread_section", { action: "move", threadId: targetId, sectionId })
      .pipe(Stream.unwrap, Stream.runCollect);
    yield* toolkit
      .handle("t3_thread_note", { action: "set", threadId: targetId, note: "Keep the full note" })
      .pipe(Stream.unwrap, Stream.runCollect);
    const read = yield* toolkit
      .handle("t3_thread_note", { action: "read", threadId: targetId })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(read.at(-1)?.result).toMatchObject({ threadId: targetId, note: "Keep the full note" });
    yield* toolkit
      .handle("t3_thread_note", { action: "clear", threadId: targetId })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect((yield* store.snapshot).threads["local:target"]).toMatchObject({
      note: null,
      placement: { sectionId },
    });
    yield* toolkit
      .handle("t3_thread_section", { action: "move", threadId: targetId, sectionId: null })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect((yield* store.snapshot).threads["local:target"]?.placement).toBeNull();
  }).pipe(
    Effect.provide(layer),
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope()),
  ),
);

it.effect("read-only clients can read notes but cannot change notes or sections", () =>
  Effect.gen(function* () {
    const toolkit = yield* SidebarToolkit;
    for (const action of ["set", "clear"] as const) {
      const response = yield* toolkit
        .handle("t3_thread_note", { action, threadId: targetId, note: "No" })
        .pipe(Stream.unwrap, Stream.runCollect);
      expect(response.at(-1)?.result).toMatchObject({ code: "capability_denied" });
    }
    const create = yield* toolkit
      .handle("t3_sections", { action: "create", name: "No" })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(create.at(-1)?.result).toMatchObject({ code: "capability_denied" });
    const read = yield* toolkit
      .handle("t3_thread_note", { action: "read", threadId: targetId })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(read.at(-1)?.result).toMatchObject({ note: null });
    const store = yield* Organization.SidebarOrganization;
    expect((yield* store.snapshot).revision).toBe(0);
  }).pipe(
    Effect.provide(layer),
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope("read-only")),
  ),
);

it.effect("rechecks the target mode after waiting for its lock", () =>
  Effect.gen(function* () {
    const raised = yield* Ref.make(false);
    const checked = yield* Deferred.make<void>();
    const threadLayer = Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (id) =>
        Effect.gen(function* () {
          const shell = liveThreadShell(id, {
            runtimeMode:
              id === targetId && (yield* Ref.get(raised)) ? "full-access" : "approval-required",
          });
          if (id === targetId) yield* Deferred.succeed(checked, undefined);
          return shell;
        }),
    });
    yield* Effect.gen(function* () {
      const toolkit = yield* SidebarToolkit;
      const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
      const held = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const holder = yield* executor
        .withLock(
          targetId,
          Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release))),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(held);
      const write = yield* toolkit
        .handle("t3_thread_note", { action: "set", threadId: targetId, note: "Must not save" })
        .pipe(Stream.unwrap, Stream.runCollect, Effect.forkChild);
      yield* Deferred.await(checked);
      yield* Ref.set(raised, true);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(holder);
      const response = yield* Fiber.join(write);
      expect(response.at(-1)?.result).toMatchObject({ code: "runtime_mode_escalation_denied" });
      const store = yield* Organization.SidebarOrganization;
      expect((yield* store.snapshot).revision).toBe(0);
    }).pipe(
      Effect.provide(makeLayer(threadLayer)),
      Effect.provideService(McpInvocationContext.McpInvocationContext, scope()),
    );
  }),
);

it.effect("does not create a section when its caller's turn ends while persistence is locked", () =>
  Effect.gen(function* () {
    const ended = yield* Ref.make(false);
    const checked = yield* Deferred.make<void>();
    const threadLayer = Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (id) =>
        Effect.gen(function* () {
          const shell = (yield* Ref.get(ended))
            ? liveThreadShell(id, { activeRunId: null })
            : liveThreadShell(id);
          yield* Deferred.succeed(checked, undefined);
          return shell;
        }),
    });
    yield* Effect.gen(function* () {
      const toolkit = yield* SidebarToolkit;
      const store = yield* Organization.SidebarOrganization;
      const held = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const holder = yield* store
        .mutate(
          { type: "thread.note", threadKey: "local:other", note: "Keep" },
          Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release))),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(held);
      const write = yield* toolkit
        .handle("t3_sections", { action: "create", name: "Must not create" })
        .pipe(Stream.unwrap, Stream.runCollect, Effect.forkChild);
      yield* Deferred.await(checked);
      yield* Ref.set(ended, true);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(holder);
      const response = yield* Fiber.join(write);
      expect(response.at(-1)?.result).toMatchObject({ code: "parent_not_active" });
      expect((yield* store.snapshot).sections).toEqual([]);
    }).pipe(
      Effect.provide(makeLayer(threadLayer)),
      Effect.provideService(McpInvocationContext.McpInvocationContext, scope()),
    );
  }),
);

it.effect("keeps a limited link fenced to its own threads and denies section management", () =>
  Effect.gen(function* () {
    const client = { sessionId: "peer-link", label: "Peer", access: "auto" as const, linked: true };
    const linkedScope: McpInvocationContext.McpInvocationScope = {
      ...scope("full-access"),
      client,
    };
    const threadLayer = Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (id) =>
        Effect.succeed({
          ...liveThreadShell(id, { runtimeMode: "approval-required" }),
          ...(id === threadId
            ? {
                linkOrigin: {
                  sessionId: client.sessionId,
                  label: client.label,
                  access: client.access,
                },
              }
            : {}),
        }),
    });
    yield* Effect.gen(function* () {
      const toolkit = yield* SidebarToolkit;
      const denied = yield* toolkit
        .handle("t3_thread_note", { action: "set", threadId: targetId, note: "No" })
        .pipe(Stream.unwrap, Stream.runCollect);
      expect(denied.at(-1)?.result).toMatchObject({ code: "capability_denied" });
      const own = yield* toolkit
        .handle("t3_thread_note", { action: "set", threadId, note: "Allowed" })
        .pipe(Stream.unwrap, Stream.runCollect);
      expect(own.at(-1)?.result).toMatchObject({ note: "Allowed" });
      const section = yield* toolkit
        .handle("t3_sections", { action: "create", name: "No" })
        .pipe(Stream.unwrap, Stream.runCollect);
      expect(section.at(-1)?.result).toMatchObject({ code: "capability_denied" });
      const store = yield* Organization.SidebarOrganization;
      expect((yield* store.snapshot).threads["local:target"]).toBeUndefined();
    }).pipe(
      Effect.provide(makeLayer(threadLayer)),
      Effect.provideService(McpInvocationContext.McpInvocationContext, linkedScope),
    );
  }),
);

it.effect(
  "does not use a collection on another machine while linked environments is disabled",
  () =>
    Effect.gen(function* () {
      const toolkit = yield* SidebarToolkit;
      const response = yield* toolkit
        .handle("t3_thread_section", {
          action: "move",
          threadId: targetId,
          sectionId: "remote-section",
          collectionEnvironmentId: EnvironmentId.make("peer"),
        })
        .pipe(Stream.unwrap, Stream.runCollect);
      expect(response.at(-1)?.result).toMatchObject({ code: "capability_denied" });
      const store = yield* Organization.SidebarOrganization;
      expect((yield* store.snapshot).revision).toBe(0);
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        ...scope(),
        linkedEnvironments: false,
      }),
    ),
);

it.effect(
  "retains but identifies an unverified placement when its collection owner is offline",
  () =>
    Effect.gen(function* () {
      const toolkit = yield* SidebarToolkit;
      const store = yield* Organization.SidebarOrganization;
      yield* store.mutate({
        type: "thread.place",
        threadKey: "local:target",
        placement: { collectionEnvironmentId: "offline", sectionId: "saved", orderKey: "m" },
      });
      const read = yield* toolkit
        .handle("t3_thread_section", { action: "read", threadId: targetId })
        .pipe(Stream.unwrap, Stream.runCollect);
      expect(read.at(-1)?.result).toMatchObject({
        placement: { sectionId: "saved" },
        sectionExists: null,
      });
      const move = yield* toolkit
        .handle("t3_thread_section", {
          action: "move",
          threadId: targetId,
          collectionEnvironmentId: EnvironmentId.make("offline"),
          sectionId: "new",
        })
        .pipe(Stream.unwrap, Stream.runCollect);
      expect(move.at(-1)?.result).toMatchObject({ code: "orchestration_error" });
      expect((yield* store.snapshot).threads["local:target"]?.placement?.sectionId).toBe("saved");
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(McpInvocationContext.McpInvocationContext, scope()),
    ),
);

it.effect.each(["auto", "full-access"] as const)(
  "stores a foreign section reference through a one-way %s link without using reverse credentials",
  (access) =>
    Effect.gen(function* () {
      const client = { sessionId: "main-link", label: "Main", access, linked: true };
      const linkedScope: McpInvocationContext.McpInvocationScope = {
        ...scope("full-access"),
        client,
      };
      const threadLayer = Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (id) =>
          Effect.succeed({
            ...liveThreadShell(id, { runtimeMode: "approval-required" }),
            linkOrigin: { sessionId: client.sessionId, label: client.label, access },
          }),
      });
      yield* Effect.gen(function* () {
        const toolkit = yield* SidebarToolkit;
        const moved = yield* toolkit
          .handle("t3_thread_section", {
            action: "move",
            threadId: targetId,
            collectionEnvironmentId: EnvironmentId.make("main"),
            sectionId: "work",
          })
          .pipe(Stream.unwrap, Stream.runCollect);
        expect(moved.at(-1)?.result).toMatchObject({
          placement: { collectionEnvironmentId: "main", sectionId: "work" },
          sectionExists: null,
        });
        const store = yield* Organization.SidebarOrganization;
        expect((yield* store.snapshot).threads["local:target"]?.placement?.sectionId).toBe("work");
      }).pipe(
        Effect.provide(makeLayer(threadLayer)),
        Effect.provideService(McpInvocationContext.McpInvocationContext, linkedScope),
      );
    }),
);
