import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as SidebarMcpService from "../../SidebarMcpService.ts";
import { SidebarToolkit } from "./tools.ts";

const call = Effect.fn("sidebar.call")(function* () {
  return {
    scope: yield* McpInvocationContext.McpInvocationContext,
    service: yield* SidebarMcpService.SidebarMcpService,
  };
});
export const layer = McpToolAccess.toLayer(SidebarToolkit, {
  t3_sections: McpToolAccess.either(
    (input) => input.action === "list",
    McpToolAccess.reads((input) =>
      Effect.flatMap(call(), ({ scope, service }) => service.sections(scope, input)),
    ),
    McpToolAccess.writesEnvironment((input, check) =>
      Effect.flatMap(call(), ({ scope, service }) => service.sections(scope, input, check)),
    ),
  ),
  t3_thread_note: McpToolAccess.either(
    (input) => input.action === "read",
    McpToolAccess.reads((input) =>
      Effect.flatMap(call(), ({ scope, service }) => service.note(scope, input)),
    ),
    McpToolAccess.writesThreads(
      (input) => [input.threadId],
      (input) => Effect.flatMap(call(), ({ scope, service }) => service.note(scope, input)),
    ),
  ),
  t3_thread_section: McpToolAccess.either(
    (input) => input.action === "read",
    McpToolAccess.reads((input) =>
      Effect.flatMap(call(), ({ scope, service }) => service.placement(scope, input)),
    ),
    McpToolAccess.writesThreads(
      (input) => [input.threadId],
      (input) => Effect.flatMap(call(), ({ scope, service }) => service.placement(scope, input)),
    ),
  ),
});
