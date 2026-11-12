import { describe, expect, it } from "vite-plus/test";
import { EMPTY_SIDEBAR_ORGANIZATION } from "@t3tools/contracts/sidebarOrganization";
import { buildLegacyImport, composeOrganizationView, threadEnvironmentForKey } from "./logic";

const legacySections = {
  sections: [{ id: "work", name: "Work", collapsed: true }],
  assignments: { "main:same": "work", "peer:same": "work" },
  chatsCollapsed: false,
  threadOrder: ["peer:same", "main:same"],
};

describe("shared organization migration and projection", () => {
  it("keeps qualified identities, IDs and manual order when importing one cross-machine section", () => {
    const result = buildLegacyImport("profile", "main", legacySections, {
      "main:same": "Local",
      "peer:same": "Remote",
    });
    expect(result.sections).toEqual([{ id: "work", name: "Work" }]);
    expect(result.threads["main:same"]?.note).toBe("Local");
    expect(result.threads["peer:same"]?.note).toBe("Remote");
    expect(
      result.threads["peer:same"]!.placement!.orderKey! <
        result.threads["main:same"]!.placement!.orderKey!,
    ).toBe(true);
  });
  it("uses canonical clears over legacy/cached notes and retains an offline peer's group", () => {
    const legacy = buildLegacyImport("profile", "main", legacySections, {
      "main:same": "Old",
      "peer:same": "Offline",
    });
    const root = {
      ...EMPTY_SIDEBAR_ORGANIZATION,
      sections: legacy.sections,
      threads: legacy.threads,
    };
    const peer = { ...EMPTY_SIDEBAR_ORGANIZATION, threads: { "peer:same": { note: null } } };
    const view = composeOrganizationView("main", root, new Map([["peer", peer]]), legacy);
    expect(view.notes["peer:same"]).toBeUndefined();
    expect(view.sections.assignments["peer:same"]).toBe("work");
    expect(composeOrganizationView("main", root, new Map(), legacy).notes["peer:same"]).toBe(
      "Offline",
    );
  });
  it("returns deleted sections to Chats even when an offline peer retains an old placement", () => {
    const legacy = buildLegacyImport("profile", "main", legacySections, {});
    const root = {
      ...EMPTY_SIDEBAR_ORGANIZATION,
      deletedSectionIds: ["work"],
      threads: legacy.threads,
    };
    const view = composeOrganizationView("main", root, new Map(), legacy);
    expect(view.sections.sections).toEqual([]);
    expect(view.sections.assignments).toEqual({});
  });
  it("resolves environment prefixes against known IDs without splitting a colon inside an ID", () => {
    expect(
      threadEnvironmentForKey("environment:peer:mcp:thread", ["environment", "environment:peer"]),
    ).toBe("environment:peer");
    expect(threadEnvironmentForKey("unknown:thread", ["main"])).toBeNull();
  });
});
