import { ThreadId } from "@t3tools/contracts";
import {
  SidebarOrganizationError,
  type SidebarOrganizationMutation,
  type SidebarOrganizationState,
} from "@t3tools/contracts/sidebarOrganization";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as SidebarOrganization from "./SidebarOrganization.ts";

export class SidebarOrganizationApplication extends Context.Service<
  SidebarOrganizationApplication,
  {
    readonly mutate: <E = never>(
      input: SidebarOrganizationMutation,
      beforeCommit?: Effect.Effect<unknown, E>,
    ) => Effect.Effect<SidebarOrganizationState, SidebarOrganizationError | NoInfer<E>>;
  }
>()("t3/sidebar/SidebarOrganizationApplication") {}

const make = Effect.gen(function* () {
  const store = yield* SidebarOrganization.SidebarOrganization;
  const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
  const threads = yield* ThreadManagement.ThreadManagementService;

  const mutate = Effect.fn("SidebarOrganizationApplication.mutate")(function* <E = never>(
    input: SidebarOrganizationMutation,
    beforeCommit: Effect.Effect<unknown, E> = Effect.void,
  ): Effect.fn.Return<SidebarOrganizationState, SidebarOrganizationError | E> {
    if (input.type !== "thread.note" && input.type !== "thread.place")
      return yield* store.mutate(input, beforeCommit);
    const environmentId = yield* identity.getEnvironmentId;
    const prefix = `${environmentId}:`;
    if (!input.threadKey.startsWith(prefix))
      return yield* new SidebarOrganizationError({ reason: "wrong_environment" });
    const threadId = ThreadId.make(input.threadKey.slice(prefix.length));
    return yield* executor.withLock(
      threadId,
      Effect.gen(function* () {
        const target = yield* threads
          .getThreadShell(threadId)
          .pipe(
            Effect.mapError(
              (cause) => new SidebarOrganizationError({ reason: "storage_unavailable", cause }),
            ),
          );
        const clearing =
          input.type === "thread.note" ? input.note === null : input.placement === null;
        // A user deleting a thread may clear its auxiliary metadata after its shell was removed.
        if ((target === null || target.deletedAt !== null) && !clearing)
          return yield* new SidebarOrganizationError({ reason: "thread_not_found" });
        return yield* store.mutate(input, beforeCommit);
      }),
    );
  });
  return SidebarOrganizationApplication.of({ mutate });
});

export const layer = Layer.effect(SidebarOrganizationApplication, make);
