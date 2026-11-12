import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  SidebarSectionsMcpInput,
  SidebarSectionsMcpResult,
  SidebarThreadNoteMcpInput,
  SidebarThreadNoteMcpResult,
  SidebarThreadSectionMcpInput,
  SidebarThreadSectionMcpResult,
} from "@t3tools/contracts/sidebarOrganization";
import { Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as SidebarMcpService from "../../SidebarMcpService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";

const common = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    SidebarMcpService.SidebarMcpService,
    ThreadManagement.ThreadManagementService,
  ],
};
export const SidebarToolkit = Toolkit.make(
  Tool.make("t3_sections", {
    ...common,
    description:
      "Custom sidebar sections on this server. list returns IDs in display order. create needs name; rename needs sectionId/name; reorder needs every sectionId once in sectionIds; delete needs sectionId and returns its chats to Chats without deleting conversations. Writes require Full Access/default mode. Use the main server as environmentId for your shared collection.",
    parameters: SidebarSectionsMcpInput,
    success: SidebarSectionsMcpResult,
  }).annotate(Tool.Destructive, true),
  Tool.make("t3_thread_note", {
    ...common,
    description:
      "Read, set, or clear a chat's full sidebar note (500 characters maximum). Omit threadId for this chat. set needs note; blank clears it. The sidebar shows a short preview. environmentId selects the chat's owning machine; writes use the same permissions as other thread changes.",
    parameters: SidebarThreadNoteMcpInput,
    success: SidebarThreadNoteMcpResult,
  }).annotate(Tool.Destructive, true),
  Tool.make("t3_thread_section", {
    ...common,
    description:
      "Read or move a chat's custom-section placement. Omit threadId for this chat. move needs sectionId from t3_sections, or null for Chats. For a shared section on another server, pass its collectionEnvironmentId; environmentId selects the chat's owning machine. Placement is remembered while pinned, working, snoozed, or settled. sectionExists is null when its collection cannot be checked.",
    parameters: SidebarThreadSectionMcpInput,
    success: SidebarThreadSectionMcpResult,
  }).annotate(Tool.Destructive, true),
);
