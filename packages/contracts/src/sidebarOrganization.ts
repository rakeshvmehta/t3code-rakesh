import * as Schema from "effect/Schema";
import { EnvironmentId, ThreadId } from "./baseSchemas.ts";
import { OrchestratorMcpEnvironmentTarget } from "./orchestratorMcp.ts";

const SectionId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const SectionName = Schema.String.check(Schema.isMinLength(1));
const ThreadKey = Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(500));

export const SidebarOrganizationSection = Schema.Struct({ id: SectionId, name: SectionName });
export type SidebarOrganizationSection = typeof SidebarOrganizationSection.Type;

export const SidebarThreadPlacement = Schema.Struct({
  collectionEnvironmentId: Schema.String,
  sectionId: SectionId,
  orderKey: Schema.NullOr(Schema.String),
});
export type SidebarThreadPlacement = typeof SidebarThreadPlacement.Type;

// Missing fields can be imported; null is an intentional clear and must survive later imports.
export const SidebarThreadOrganization = Schema.Struct({
  note: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(500)))),
  placement: Schema.optionalKey(Schema.NullOr(SidebarThreadPlacement)),
});
export type SidebarThreadOrganization = typeof SidebarThreadOrganization.Type;

export const SidebarOrganizationPeerSnapshot = Schema.Struct({
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  threads: Schema.Record(ThreadKey, SidebarThreadOrganization),
});
export const SidebarOrganizationCache = Schema.Struct({
  environmentId: EnvironmentId,
  ...SidebarOrganizationPeerSnapshot.fields,
});
export type SidebarOrganizationCache = typeof SidebarOrganizationCache.Type;

export const SidebarOrganizationState = Schema.Struct({
  version: Schema.Literal(1),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  threadRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sections: Schema.Array(SidebarOrganizationSection),
  deletedSectionIds: Schema.Array(SectionId),
  threads: Schema.Record(ThreadKey, SidebarThreadOrganization),
  importedSources: Schema.Array(Schema.String),
  cachedEnvironments: Schema.Record(Schema.String, SidebarOrganizationPeerSnapshot),
});
export type SidebarOrganizationState = typeof SidebarOrganizationState.Type;

export const EMPTY_SIDEBAR_ORGANIZATION: SidebarOrganizationState = {
  version: 1,
  revision: 0,
  threadRevision: 0,
  sections: [],
  deletedSectionIds: [],
  threads: {},
  importedSources: [],
  cachedEnvironments: {},
};

export const SidebarOrganizationMutation = Schema.Union([
  Schema.Struct({ type: Schema.Literal("section.create"), id: SectionId, name: SectionName }),
  Schema.Struct({ type: Schema.Literal("section.rename"), id: SectionId, name: SectionName }),
  Schema.Struct({ type: Schema.Literal("section.delete"), id: SectionId }),
  Schema.Struct({ type: Schema.Literal("section.reorder"), sectionIds: Schema.Array(SectionId) }),
  Schema.Struct({
    type: Schema.Literal("thread.note"),
    threadKey: ThreadKey,
    note: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.place"),
    threadKey: ThreadKey,
    placement: Schema.NullOr(SidebarThreadPlacement),
  }),
]);
export type SidebarOrganizationMutation = typeof SidebarOrganizationMutation.Type;

export const SidebarOrganizationImport = Schema.Struct({
  sourceId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  sections: Schema.Array(SidebarOrganizationSection),
  threads: Schema.Record(ThreadKey, SidebarThreadOrganization),
});
export type SidebarOrganizationImport = typeof SidebarOrganizationImport.Type;

export class SidebarOrganizationError extends Schema.TaggedError<SidebarOrganizationError>()(
  "SidebarOrganizationError",
  {
    reason: Schema.Literals([
      "storage_unavailable",
      "invalid_state",
      "section_not_found",
      "section_conflict",
      "invalid_order",
      "thread_not_found",
      "wrong_environment",
    ]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "thread_not_found":
        return "The thread no longer exists.";
      case "wrong_environment":
        return "Thread organization must be changed on the thread’s owning environment.";
      case "storage_unavailable":
        return "Sidebar organization could not be saved or read.";
      case "invalid_state":
        return "Sidebar organization data is invalid; the existing file was preserved.";
      case "section_not_found":
        return "The custom section no longer exists.";
      case "section_conflict":
        return "The custom section ID already exists or was deleted.";
      case "invalid_order":
        return "Section order must contain every current section exactly once.";
    }
  }
}

export const isSidebarOrganizationError = Schema.is(SidebarOrganizationError);

export const SidebarSectionsMcpInput = Schema.Struct({
  action: Schema.Literals(["list", "create", "rename", "reorder", "delete"]),
  environmentId: OrchestratorMcpEnvironmentTarget,
  sectionId: Schema.optional(SectionId),
  name: Schema.optional(SectionName),
  sectionIds: Schema.optional(Schema.Array(SectionId)),
});
export type SidebarSectionsMcpInput = typeof SidebarSectionsMcpInput.Type;
export const SidebarSectionsMcpResult = Schema.Struct({
  collectionEnvironmentId: EnvironmentId,
  revision: Schema.Number,
  sections: Schema.Array(SidebarOrganizationSection),
});
export type SidebarSectionsMcpResult = typeof SidebarSectionsMcpResult.Type;

export const SidebarThreadNoteMcpInput = Schema.Struct({
  action: Schema.Literals(["read", "set", "clear"]),
  environmentId: OrchestratorMcpEnvironmentTarget,
  threadId: Schema.optional(ThreadId),
  note: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
});
export type SidebarThreadNoteMcpInput = typeof SidebarThreadNoteMcpInput.Type;
export const SidebarThreadNoteMcpResult = Schema.Struct({
  threadId: ThreadId,
  note: Schema.NullOr(Schema.String),
});
export type SidebarThreadNoteMcpResult = typeof SidebarThreadNoteMcpResult.Type;

export const SidebarThreadSectionMcpInput = Schema.Struct({
  action: Schema.Literals(["read", "move"]),
  environmentId: OrchestratorMcpEnvironmentTarget,
  threadId: Schema.optional(ThreadId),
  collectionEnvironmentId: Schema.optional(EnvironmentId),
  sectionId: Schema.optional(Schema.NullOr(SectionId)),
});
export type SidebarThreadSectionMcpInput = typeof SidebarThreadSectionMcpInput.Type;
export const SidebarThreadSectionMcpResult = Schema.Struct({
  threadId: ThreadId,
  placement: Schema.NullOr(SidebarThreadPlacement),
  sectionExists: Schema.NullOr(Schema.Boolean),
});
export type SidebarThreadSectionMcpResult = typeof SidebarThreadSectionMcpResult.Type;
