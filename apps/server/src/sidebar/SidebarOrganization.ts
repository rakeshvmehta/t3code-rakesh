import {
  applySidebarOrganizationMutation,
  applySidebarOrganizationImport,
} from "@t3tools/shared/sidebarOrganization";
import {
  EMPTY_SIDEBAR_ORGANIZATION,
  SidebarOrganizationCache,
  SidebarOrganizationError,
  isSidebarOrganizationError,
  SidebarOrganizationImport,
  SidebarOrganizationMutation,
  SidebarOrganizationState,
} from "@t3tools/contracts/sidebarOrganization";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";

export class SidebarOrganization extends Context.Service<
  SidebarOrganization,
  {
    readonly cachePeer: (
      input: SidebarOrganizationCache,
    ) => Effect.Effect<SidebarOrganizationState, SidebarOrganizationError>;
    readonly snapshot: Effect.Effect<SidebarOrganizationState, SidebarOrganizationError>;
    readonly changes: Stream.Stream<SidebarOrganizationState, SidebarOrganizationError>;
    readonly mutate: <E = never>(
      input: SidebarOrganizationMutation,
      beforeCommit?: Effect.Effect<unknown, E>,
    ) => Effect.Effect<SidebarOrganizationState, SidebarOrganizationError | NoInfer<E>>;
    readonly importLegacy: (
      input: SidebarOrganizationImport,
    ) => Effect.Effect<SidebarOrganizationState, SidebarOrganizationError>;
  }
>()("t3/sidebar/SidebarOrganization") {}

const stateJson = Schema.fromJsonString(SidebarOrganizationState);
const decodeState = Schema.decodeEffect(stateJson);
const encodeState = Schema.encodeEffect(stateJson);
const decodeMutation = Schema.decodeEffect(SidebarOrganizationMutation);
const decodeImport = Schema.decodeEffect(SidebarOrganizationImport);
const encodeImport = Schema.encodeEffect(Schema.fromJsonString(SidebarOrganizationImport));
const decodeCache = Schema.decodeEffect(SidebarOrganizationCache);

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const io = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const filePath = path.join(config.stateDir, "sidebar-organization.json");
  const storageError = (cause: unknown) =>
    new SidebarOrganizationError({ reason: "storage_unavailable", cause });
  const readFile = Effect.gen(function* () {
    if (!(yield* fs.exists(filePath))) return EMPTY_SIDEBAR_ORGANIZATION;
    const raw = yield* fs.readFileString(filePath);
    return yield* decodeState(raw).pipe(
      Effect.mapError((cause) => new SidebarOrganizationError({ reason: "invalid_state", cause })),
    );
  }).pipe(
    Effect.mapError((cause) => (isSidebarOrganizationError(cause) ? cause : storageError(cause))),
  );
  const state = yield* Ref.make<SidebarOrganizationState | undefined>(undefined);
  const lock = yield* Semaphore.make(1);
  const updates = yield* PubSub.unbounded<SidebarOrganizationState>();
  const load = Effect.gen(function* () {
    const cached = yield* Ref.get(state);
    if (cached !== undefined) return cached;
    const initial = yield* readFile;
    yield* Ref.set(state, initial);
    return initial;
  });
  const snapshot = lock.withPermits(1)(load);

  const persist = Effect.fn("SidebarOrganization.persist")(function* (
    next: SidebarOrganizationState,
  ) {
    yield* writeFileStringAtomically({
      filePath,
      contents: yield* encodeState(next).pipe(Effect.mapError(storageError)),
    }).pipe(Effect.provide(io), Effect.mapError(storageError));
    yield* Ref.set(state, next);
    yield* PubSub.publish(updates, next);
    return next;
  });

  const mutate = Effect.fn("SidebarOrganization.mutate")(function* <E = never>(
    input: SidebarOrganizationMutation,
    beforeCommit: Effect.Effect<unknown, E> = Effect.void,
  ): Effect.fn.Return<SidebarOrganizationState, SidebarOrganizationError | E> {
    yield* decodeMutation(input).pipe(
      Effect.mapError((cause) => new SidebarOrganizationError({ reason: "invalid_state", cause })),
    );
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* load;
        const next = yield* applySidebarOrganizationMutation(current, input);
        yield* beforeCommit;
        return yield* Effect.uninterruptible(persist(next));
      }),
    );
  });

  const importLegacy = Effect.fn("SidebarOrganization.importLegacy")(function* (
    input: SidebarOrganizationImport,
  ) {
    yield* decodeImport(input).pipe(
      Effect.mapError((cause) => new SidebarOrganizationError({ reason: "invalid_state", cause })),
    );
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* load;
        if (current.importedSources.includes(input.sourceId)) return current;
        const backup = path.join(
          config.stateDir,
          "sidebar-organization-imports",
          `${encodeURIComponent(input.sourceId)}.json`,
        );
        if (!(yield* fs.exists(backup).pipe(Effect.mapError(storageError))))
          yield* writeFileStringAtomically({
            filePath: backup,
            contents: yield* encodeImport(input).pipe(Effect.mapError(storageError)),
          }).pipe(Effect.provide(io), Effect.mapError(storageError));
        return yield* Effect.uninterruptible(
          persist(applySidebarOrganizationImport(current, input)),
        );
      }),
    );
  });

  const cachePeer = Effect.fn("SidebarOrganization.cachePeer")(function* (
    input: SidebarOrganizationCache,
  ) {
    yield* decodeCache(input).pipe(
      Effect.mapError((cause) => new SidebarOrganizationError({ reason: "invalid_state", cause })),
    );
    if (Object.keys(input.threads).some((key) => !key.startsWith(`${input.environmentId}:`)))
      return yield* new SidebarOrganizationError({ reason: "wrong_environment" });
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* load;
        if ((current.cachedEnvironments[input.environmentId]?.revision ?? -1) >= input.revision)
          return current;
        return yield* Effect.uninterruptible(
          persist({
            ...current,
            revision: current.revision + 1,
            cachedEnvironments: {
              ...current.cachedEnvironments,
              [input.environmentId]: { revision: input.revision, threads: input.threads },
            },
          }),
        );
      }),
    );
  });

  return SidebarOrganization.of({
    snapshot,
    cachePeer,
    changes: Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(updates);
        const initial = yield* snapshot;
        return Stream.concat(
          Stream.make(initial),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((next) => next.revision > initial.revision),
          ),
        );
      }),
    ),
    mutate,
    importLegacy,
  });
});

export const layer = Layer.effect(SidebarOrganization, make);
