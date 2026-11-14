import "~/index.css";
import { RegistryContext } from "@effect/atom-react";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { EMPTY_SIDEBAR_ORGANIZATION } from "@t3tools/contracts/sidebarOrganization";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  sidebarOrganizationSnapshot,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";
import { useEffect } from "react";
import { useSidebarSections } from "./sidebarSections/useSidebarSections";
import { SIDEBAR_SECTIONS_STORAGE_KEY } from "./sidebarSections/sidebarSections.logic";
import { THREAD_NOTES_STORAGE_KEY } from "./rakesh/threadNotes.logic";

const bootstrap = vi.hoisted(() => ({ dispose: () => {} }));

// Model a client-only desktop connected to its host service. Transport and
// desktop topology are the boundaries; organization view/sync/actions stay real.
vi.mock(import("~/state/primaryEnvironment"), async (original) => {
  const [{ Atom }, fixtures, { EMPTY_SIDEBAR_ORGANIZATION }] = await Promise.all([
    import("effect/reactivity"),
    import("../../test/fakeEnvironment"),
    import("@t3tools/contracts/sidebarOrganization"),
  ]);
  // Discovery starts while the runtime module loads; install its HTTP boundary
  // first so it cannot contact a real backend before the test body runs.
  const initialEnvironment = fixtures.installFakeEnvironment([], {
    sidebarOrganization: EMPTY_SIDEBAR_ORGANIZATION,
  });
  bootstrap.dispose = () => initialEnvironment[Symbol.dispose]();
  const actual = await original();
  const { ENVIRONMENT_ID } = fixtures;
  return {
    ...actual,
    primaryEnvironmentIdAtom: Atom.make(null),
    hostEnvironmentIdAtom: Atom.make<string | null>(ENVIRONMENT_ID),
  };
});
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (original) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    original<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});
vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it("shows saved host memberships, imports legacy notes and routes section/placement edits in client-only mode", async () => {
  using _bootstrap = { [Symbol.dispose]: bootstrap.dispose };
  await page.viewport(1400, 900);
  const [assigned, unassigned] = [
    threadWithHistory("saved", 1),
    threadWithHistory("unassigned", 1),
  ];
  const savedKey = `${ENVIRONMENT_ID}:${assigned.id}`;
  const otherKey = `${ENVIRONMENT_ID}:${unassigned.id}`;
  using _environment = installFakeEnvironment([assigned, unassigned], {
    sidebarOrganization: {
      ...EMPTY_SIDEBAR_ORGANIZATION,
      sections: [{ id: "priority", name: "Priority" }],
      threads: {
        [savedKey]: {
          placement: {
            collectionEnvironmentId: ENVIRONMENT_ID,
            sectionId: "priority",
            orderKey: "a",
          },
        },
      },
    },
  });
  const legacy = JSON.stringify({
    sections: [{ id: "priority", name: "Priority", collapsed: true }],
    assignments: {},
    chatsCollapsed: false,
  });
  localStorage.setItem(SIDEBAR_SECTIONS_STORAGE_KEY, legacy);
  localStorage.setItem(
    THREAD_NOTES_STORAGE_KEY,
    JSON.stringify({ [otherKey]: "Keep this legacy note" }),
  );
  using _storage = {
    [Symbol.dispose]: () => {
      localStorage.removeItem(SIDEBAR_SECTIONS_STORAGE_KEY);
      localStorage.removeItem(THREAD_NOTES_STORAGE_KEY);
    },
  };
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    boringSidebarEnabled: false,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${unassigned.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });
  const header = page.getByTestId("sidebar-custom-section-toggle");
  await expect.element(header).toHaveTextContent("Priority (1)");
  await expect
    .element(page.getByText(assigned.title, { exact: true }).first())
    .not.toBeInTheDocument();
  await header.click();
  await expect.element(page.getByText(assigned.title, { exact: true }).first()).toBeVisible();
  await expect
    .poll(() => sidebarOrganizationSnapshot()?.threads[otherKey]?.note)
    .toBe("Keep this legacy note");
  await page.getByRole("button", { name: "New section", exact: true }).click();
  await page.getByRole("textbox", { name: "Section name", exact: true }).fill("Created on host");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => sidebarOrganizationSnapshot()?.sections.map((s) => s.name))
    .toEqual(["Priority", "Created on host"]);
  let assign: ReturnType<typeof useSidebarSections>["assign"] = () => Promise.resolve(false);
  function PlacementProbe() {
    const sections = useSidebarSections([savedKey, otherKey]);
    useEffect(() => {
      assign = sections.assign;
    }, [sections.assign]);
    return null;
  }
  await using _probe = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <PlacementProbe />
    </RegistryContext.Provider>,
    { router: false },
  );
  await act(() => assign(otherKey, "priority"));
  await expect
    .poll(() => sidebarOrganizationSnapshot()?.threads[otherKey]?.placement)
    .toEqual({ collectionEnvironmentId: ENVIRONMENT_ID, sectionId: "priority", orderKey: null });
  expect(sidebarOrganizationSnapshot()?.threads[savedKey]?.placement).toEqual({
    collectionEnvironmentId: ENVIRONMENT_ID,
    sectionId: "priority",
    orderKey: "a",
  });
  expect(localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY)).toBe(legacy);
});
