import { expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as PeerForwarding from "./PeerForwarding.ts";
import * as PeerMcpClient from "./PeerMcpClient.ts";
import * as PeerLinks from "./PeerLinks.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { SidebarToolkit } from "../mcp/toolkits/sidebar/tools.ts";
import type { McpInvocationScope } from "../mcp/McpInvocationContext.ts";

const scope: McpInvocationScope = {
  thread: undefined,
  client: undefined,
  environmentId: EnvironmentId.make("pc"),
  requestNamespace: "test",
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};
it.effect.each([false, true])(
  "checks scoped placement support before remote moves (supported=%s)",
  (supported) =>
    Effect.gen(function* () {
      const seen: unknown[] = [];
      const layer = PeerForwarding.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            NodeCrypto.layer,
            Layer.mock(PeerLinks.PeerLinks)({
              enabled: Effect.succeed(true),
              get: () => Effect.succeedNone,
            }),
            Layer.mock(ThreadManagement.ThreadManagementService)({}),
            Layer.mock(PeerMcpClient.PeerMcpClient)({
              call: (input) => {
                seen.push(input.arguments);
                // oxlint-disable-next-line t3code/no-inline-schema-compile -- The peer caller supplies the response schema dynamically.
                return Schema.decodeEffect(input.success)({
                  threadId: "thread",
                  placement: null,
                  sectionExists: false,
                  ...(supported ? { placementScope: "collection" } : {}),
                }).pipe(Effect.orDie);
              },
            }),
          ),
        ),
      );
      const forwarding = yield* PeerForwarding.PeerForwarding.pipe(Effect.provide(layer));
      for (const sectionId of ["work", null]) {
        const result = yield* Effect.result(
          forwarding.call(
            scope,
            SidebarToolkit.tools.t3_thread_section,
            EnvironmentId.make("mac"),
            {
              action: "move",
              threadId: ThreadId.make("thread"),
              collectionEnvironmentId: EnvironmentId.make("pc"),
              sectionId,
            },
          ),
        );
        expect(result._tag).toBe(supported ? "Success" : "Failure");
      }
      expect(seen).toEqual(
        ["work", null].flatMap((sectionId) => [
          { action: "read", threadId: "thread", collectionEnvironmentId: "pc", sectionId },
          ...(supported
            ? [{ action: "move", threadId: "thread", collectionEnvironmentId: "pc", sectionId }]
            : []),
        ]),
      );
    }),
);
