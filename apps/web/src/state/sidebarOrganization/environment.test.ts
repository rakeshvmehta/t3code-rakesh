import { EnvironmentId } from "@t3tools/contracts";
import {
  EMPTY_SIDEBAR_ORGANIZATION,
  type SidebarOrganizationState,
} from "@t3tools/contracts/sidebarOrganization";
import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { createLocalEnvironmentIdAtom } from "../primaryEnvironment";
import { buildLegacyImport, composeOrganizationView } from "./logic";

const MAC = EnvironmentId.make("mac");
const PC = EnvironmentId.make("company-pc");
const VM = EnvironmentId.make("personal-vm");

describe("organization collection on a client-only desktop", () => {
  it("renders saved Mac and PC memberships in the Mac collection without rewriting placements", () => {
    const registry = AtomRegistry.make();
    using _registry = { [Symbol.dispose]: () => registry.dispose() };
    const collection = registry.get(
      createLocalEnvironmentIdAtom({
        primaryEnvironmentIdAtom: Atom.make(null),
        hostEnvironmentIdAtom: Atom.make("mac"),
        catalogValueAtom: Atom.make({
          entries: new Map([
            [PC, null],
            [VM, null],
            [MAC, null],
          ]),
        }),
      }),
    );
    expect(collection).toBe(MAC);
    const root = {
      ...EMPTY_SIDEBAR_ORGANIZATION,
      sections: [{ id: "work", name: "Work" }],
      threads: {
        "mac:local": {
          placement: { collectionEnvironmentId: MAC, sectionId: "work", orderKey: "b" },
        },
      },
    };
    const pc = {
      ...EMPTY_SIDEBAR_ORGANIZATION,
      threads: {
        "company-pc:remote": {
          placement: { collectionEnvironmentId: MAC, sectionId: "work", orderKey: "a" },
        },
      },
    };
    const vm = {
      ...EMPTY_SIDEBAR_ORGANIZATION,
      threads: {
        "personal-vm:other": {
          placement: { collectionEnvironmentId: VM, sectionId: "work", orderKey: "a" },
        },
      },
    };
    const before = JSON.stringify([root, pc, vm]);
    const legacy = buildLegacyImport(
      "display",
      collection!,
      { sections: [], assignments: {}, chatsCollapsed: false },
      {},
    );
    const view = composeOrganizationView(
      collection!,
      root,
      new Map<EnvironmentId, SidebarOrganizationState>([
        [PC, pc],
        [VM, vm],
      ]),
      legacy,
    );
    expect(view.sections.assignments).toEqual({ "mac:local": "work", "company-pc:remote": "work" });
    expect(view.sections.threadOrder).toEqual(["company-pc:remote", "mac:local"]);
    expect(JSON.stringify([root, pc, vm])).toBe(before);
  });

  it("keeps an explicit primary ahead of the host and never substitutes an unrelated PC or VM", () => {
    const registry = AtomRegistry.make();
    using _registry = { [Symbol.dispose]: () => registry.dispose() };
    const primary = Atom.make<EnvironmentId | null>(PC);
    const host = Atom.make<string | null>("mac");
    const catalog = Atom.make({
      entries: new Map([
        [PC, null],
        [VM, null],
        [MAC, null],
      ]),
    });
    const collection = createLocalEnvironmentIdAtom({
      primaryEnvironmentIdAtom: primary,
      hostEnvironmentIdAtom: host,
      catalogValueAtom: catalog,
    });
    using _mounted = { [Symbol.dispose]: registry.mount(collection) };
    expect(registry.get(collection)).toBe(PC);
    registry.set(primary, null);
    expect(registry.get(collection)).toBe(MAC);
    registry.set(catalog, {
      entries: new Map([
        [PC, null],
        [VM, null],
      ]),
    });
    expect(registry.get(collection)).toBeNull();
    registry.set(host, null);
    expect(registry.get(collection)).toBeNull();
    registry.set(catalog, {
      entries: new Map([
        [VM, null],
        [MAC, null],
        [PC, null],
      ]),
    });
    registry.set(host, "mac");
    expect(registry.get(collection)).toBe(MAC);
  });
});
