import { uniqueOrderKeyBetween } from "@t3tools/shared/orderKey";
import { EnvironmentId, OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import {
  isSidebarOrganizationError,
  type SidebarOrganizationError,
  type SidebarSectionsMcpInput,
  type SidebarSectionsMcpResult,
  type SidebarThreadNoteMcpInput,
  type SidebarThreadNoteMcpResult,
  type SidebarThreadSectionMcpInput,
  type SidebarThreadSectionMcpResult,
} from "@t3tools/contracts/sidebarOrganization";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as PeerForwarding from "../peer/PeerForwarding.ts";
import * as Organization from "../sidebar/SidebarOrganization.ts";
import * as OrganizationApplication from "../sidebar/SidebarOrganizationApplication.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import { assertSameLink, callerLinkOrigin } from "./linkOrigin.ts";
import {
  assertLiveCaller,
  assertTargetWithinLimits,
  loadCaller,
  readCaller,
  unavailable,
} from "./threadAccess.ts";

type Scope = McpInvocationContext.McpInvocationScope;
type Check = Effect.Effect<
  unknown,
  OrchestratorMcpFailure,
  McpInvocationContext.McpInvocationContext | ThreadManagement.ThreadManagementService
>;
export class SidebarMcpService extends Context.Service<
  SidebarMcpService,
  {
    readonly sections: (
      scope: Scope,
      input: SidebarSectionsMcpInput,
      check?: Check,
    ) => Effect.Effect<SidebarSectionsMcpResult, OrchestratorMcpFailure>;
    readonly note: (
      scope: Scope,
      input: SidebarThreadNoteMcpInput,
    ) => Effect.Effect<SidebarThreadNoteMcpResult, OrchestratorMcpFailure>;
    readonly placement: (
      scope: Scope,
      input: SidebarThreadSectionMcpInput,
    ) => Effect.Effect<SidebarThreadSectionMcpResult, OrchestratorMcpFailure>;
  }
>()("t3/mcp/SidebarMcpService") {}

const required = <A>(value: A | undefined, field: string) =>
  value === undefined
    ? Effect.fail(
        new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `This action needs ${field}.`,
        }),
      )
    : Effect.succeed(value);
const mapFailure = (error: SidebarOrganizationError | OrchestratorMcpFailure) =>
  isSidebarOrganizationError(error)
    ? new OrchestratorMcpFailure({
        code: error.reason === "thread_not_found" ? "thread_not_found" : "invalid_request",
        message: error.message,
      })
    : error;

const make = Effect.gen(function* () {
  const store = yield* Organization.SidebarOrganization;
  const app = yield* OrganizationApplication.SidebarOrganizationApplication;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const random = yield* SecureRandom.SecureRandom;
  const forwarding = yield* Effect.serviceOption(PeerForwarding.PeerForwarding);
  const withScope = <A, E>(
    scope: Scope,
    effect: Effect.Effect<
      A,
      E,
      McpInvocationContext.McpInvocationContext | ThreadManagement.ThreadManagementService
    >,
  ) =>
    effect.pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
      Effect.provideService(ThreadManagement.ThreadManagementService, threads),
    );

  const target = Effect.fn("SidebarMcpService.target")(function* (
    scope: Scope,
    requested?: ThreadId,
  ) {
    yield* withScope(scope, readCaller());
    const id = yield* required(requested ?? scope.thread?.threadId, "threadId");
    const shell = yield* threads.getThreadShell(id).pipe(Effect.mapError(unavailable));
    if (shell === null || shell.deletedAt !== null)
      return yield* new OrchestratorMcpFailure({
        code: "thread_not_found",
        message: "The thread was not found.",
      });
    return shell;
  });
  const recheck = Effect.fn("SidebarMcpService.recheck")(function* (
    scope: Scope,
    threadId: ThreadId,
  ) {
    const caller = yield* withScope(scope, loadCaller());
    yield* assertLiveCaller(caller);
    const shell = yield* target(scope, threadId);
    yield* assertTargetWithinLimits(caller.limits, shell);
    yield* assertSameLink(caller, shell);
  });

  const sections = Effect.fn("SidebarMcpService.sections")(function* (
    scope: Scope,
    input: SidebarSectionsMcpInput,
    check: Check = Effect.void,
  ) {
    yield* withScope(scope, readCaller());
    const beforeCommit = withScope(scope, check);
    const state =
      input.action === "list"
        ? yield* store.snapshot.pipe(Effect.mapError(mapFailure))
        : yield* Effect.gen(function* () {
            switch (input.action) {
              case "list":
                return yield* store.snapshot;
              case "create":
                return yield* app.mutate(
                  {
                    type: "section.create",
                    id: yield* random.uuidV4(),
                    name: yield* required(input.name, "name"),
                  },
                  beforeCommit,
                );
              case "rename":
                return yield* app.mutate(
                  {
                    type: "section.rename",
                    id: yield* required(input.sectionId, "sectionId"),
                    name: yield* required(input.name, "name"),
                  },
                  beforeCommit,
                );
              case "reorder":
                return yield* app.mutate(
                  {
                    type: "section.reorder",
                    sectionIds: yield* required(input.sectionIds, "sectionIds"),
                  },
                  beforeCommit,
                );
              case "delete":
                return yield* app.mutate(
                  { type: "section.delete", id: yield* required(input.sectionId, "sectionId") },
                  beforeCommit,
                );
            }
          }).pipe(Effect.mapError(mapFailure));
    return {
      collectionEnvironmentId: scope.environmentId,
      revision: state.revision,
      sections: state.sections,
    };
  });

  const note = Effect.fn("SidebarMcpService.note")(function* (
    scope: Scope,
    input: SidebarThreadNoteMcpInput,
  ) {
    const thread = yield* target(scope, input.threadId);
    const key = `${scope.environmentId}:${thread.id}`;
    const state =
      input.action === "read"
        ? yield* store.snapshot.pipe(Effect.mapError(mapFailure))
        : yield* app
            .mutate(
              {
                type: "thread.note",
                threadKey: key,
                note: input.action === "clear" ? null : yield* required(input.note, "note"),
              },
              recheck(scope, thread.id),
            )
            .pipe(Effect.mapError(mapFailure));
    return { threadId: thread.id, note: state.threads[key]?.note ?? null };
  });

  const placement = Effect.fn("SidebarMcpService.placement")(function* (
    scope: Scope,
    input: SidebarThreadSectionMcpInput,
  ) {
    const thread = yield* target(scope, input.threadId);
    const key = `${scope.environmentId}:${thread.id}`;
    const caller = yield* withScope(scope, readCaller());
    const receivedLink = callerLinkOrigin(caller) !== undefined;
    if (input.action === "read") {
      const state = yield* store.snapshot.pipe(Effect.mapError(mapFailure));
      const saved = state.threads[key]?.placement ?? null;
      if (saved === null) return { threadId: thread.id, placement: null, sectionExists: false };
      const listing =
        saved.collectionEnvironmentId === scope.environmentId
          ? { sections: state.sections }
          : receivedLink || scope.linkedEnvironments === false || Option.isNone(forwarding)
            ? null
            : yield* forwarding.value
                .readSidebarSections(scope, EnvironmentId.make(saved.collectionEnvironmentId))
                .pipe(Effect.orElseSucceed(() => null));
      const exists =
        listing === null
          ? null
          : listing.sections.some((section) => section.id === saved.sectionId);
      return {
        threadId: thread.id,
        placement: exists === false ? null : saved,
        sectionExists: exists,
      };
    }
    const sectionId = yield* required(input.sectionId, "sectionId (null for Chats)");
    const owner = input.collectionEnvironmentId ?? scope.environmentId;
    let sectionExists: boolean | null = sectionId !== null;
    if (sectionId !== null) {
      if (owner !== scope.environmentId && scope.linkedEnvironments === false)
        return yield* PeerForwarding.linkedEnvironmentsOff;
      // A received link has permission to change this thread, but has no reverse
      // credentials for its originating collection. Store only its reference; the
      // collection owner resolves existence and deletion in the sidebar.
      const listing =
        owner !== scope.environmentId && receivedLink
          ? null
          : owner === scope.environmentId
            ? yield* sections(scope, { action: "list" })
            : Option.isSome(forwarding)
              ? yield* forwarding.value.readSidebarSections(scope, owner)
              : yield* new OrchestratorMcpFailure({
                  code: "orchestration_error",
                  message: "The shared section's server cannot be reached.",
                });
      sectionExists =
        listing === null ? null : listing.sections.some((section) => section.id === sectionId);
      if (sectionExists === false)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message:
            "The custom section no longer exists. Read t3_sections on its collection server.",
        });
    }
    const previous = yield* store.snapshot.pipe(Effect.mapError(mapFailure));
    const existing = previous.threads[key]?.placement;
    const lastKey =
      Object.values(previous.threads)
        .flatMap((record) =>
          record.placement?.collectionEnvironmentId === owner &&
          record.placement.sectionId === sectionId &&
          record.placement.orderKey !== null
            ? [record.placement.orderKey]
            : [],
        )
        .sort()
        .at(-1) ?? null;
    const orderKey =
      existing?.collectionEnvironmentId === owner && existing.sectionId === sectionId
        ? existing.orderKey
        : uniqueOrderKeyBetween(lastKey, null, yield* random.uuidV4());
    const state = yield* app
      .mutate(
        {
          type: "thread.place",
          threadKey: key,
          placement:
            sectionId === null
              ? null
              : {
                  collectionEnvironmentId: owner,
                  sectionId,
                  orderKey,
                },
        },
        recheck(scope, thread.id),
      )
      .pipe(Effect.mapError(mapFailure));
    return {
      threadId: thread.id,
      placement: state.threads[key]?.placement ?? null,
      sectionExists,
    };
  });

  return SidebarMcpService.of({ sections, note, placement });
});
export const layer = Layer.effect(SidebarMcpService, make);
