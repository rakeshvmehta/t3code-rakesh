import { appAtomRegistry } from "~/rpc/atomRegistry";
import { legacyOrganizationAtom } from "~/state/sidebarOrganization/state";
import "~/index.css";
import { EMPTY_SIDEBAR_ORGANIZATION } from "@t3tools/contracts/sidebarOrganization";
import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The thread route loads ChatView lazily; its first transform would eat the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests, updateClientSettings } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  emitSidebarMutation,
  sidebarOrganizationSnapshot,
  rejectNextSidebarMutation,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";
import { SIDEBAR_SECTIONS_STORAGE_KEY } from "./sidebarSections/sidebarSections.logic";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it("migrates saved sections, preserves folder mode, and syncs tool/UI changes", async () => {
  await page.viewport(1400, 900);
  // Control the press guard's clock without freezing browser focus/transition timers.
  using moveClock = vi.spyOn(performance, "now").mockReturnValue(0);
  const [first, second] = [threadWithHistory("visible", 1), threadWithHistory("assigned", 1)];
  using _environment = installFakeEnvironment([first, second], {
    sidebarOrganization: EMPTY_SIDEBAR_ORGANIZATION,
  });
  const stored = JSON.stringify({
    sections: [{ id: "priority", name: "Priority", collapsed: false }],
    assignments: { [`${ENVIRONMENT_ID}:${second.id}`]: "priority" },
    chatsCollapsed: false,
  });
  localStorage.setItem(SIDEBAR_SECTIONS_STORAGE_KEY, stored);
  using _storage = {
    [Symbol.dispose]: () => localStorage.removeItem(SIDEBAR_SECTIONS_STORAGE_KEY),
  };
  const settings = {
    ...DEFAULT_CLIENT_SETTINGS,
    boringSidebarEnabled: false,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  };
  __setClientSettingsForTests(settings);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${first.id}`] }),
  );
  await router.load();
  let legacyWrites = 0;
  const stopLegacyWatch = appAtomRegistry.subscribe(legacyOrganizationAtom, () => {
    legacyWrites++;
  });
  using _legacyWatch = { [Symbol.dispose]: stopLegacyWatch };
  await using _app = await render(<AppRoot router={router} />, { router: false });
  const customSection = page.getByTestId("sidebar-custom-section-toggle");
  await expect.element(customSection).toHaveTextContent("Priority");
  await expect
    .element(page.getByRole("button", { name: "New section", exact: true }))
    .toBeVisible();
  await expect.element(page.getByText(second.title, { exact: true }).first()).toBeVisible();
  const saved = localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY);

  await act(() => updateClientSettings({ boringSidebarEnabled: true }));
  await expect.element(page.getByRole("button", { name: /^render/ })).toBeVisible();
  await expect.element(customSection).not.toBeInTheDocument();
  await expect.element(page.getByTestId("sidebar-chats-section-toggle")).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("button", { name: "New section", exact: true }))
    .not.toBeInTheDocument();
  expect(localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY)).toBe(saved);

  await act(() => updateClientSettings({ boringSidebarEnabled: false }));
  await expect.element(customSection).toHaveTextContent("Priority");
  await expect.element(page.getByText(second.title, { exact: true }).first()).toBeVisible();
  expect(localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY)).toBe(saved);
  await expect
    .poll(() => sidebarOrganizationSnapshot()?.importedSources.length ?? 0)
    .toBeGreaterThan(0);
  expect(legacyWrites).toBeLessThanOrEqual(1);
  const threadKey = `${ENVIRONMENT_ID}:${second.id}`;
  await act(() =>
    emitSidebarMutation({ type: "thread.note", threadKey, note: "Waiting on the staging deploy" }),
  );
  await expect
    .element(page.getByText("Waiting on the staging deploy", { exact: true }).first())
    .toBeVisible();
  await act(() =>
    emitSidebarMutation({ type: "section.rename", id: "priority", name: "Delivery" }),
  );
  await expect.element(customSection).toHaveTextContent("Delivery");

  // Remote section updates move rows; let the shift guard's press window expire.
  moveClock.mockReturnValue(500);
  await page
    .elementLocator(document.querySelector(`[data-thread-item="${threadKey}"]`)!)
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit note…", exact: true }).click();
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("Edited through the sidebar");
  rejectNextSidebarMutation();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .element(page.getByRole("textbox", { name: "Note", exact: true }))
    .toHaveValue("Edited through the sidebar");
  await expect.element(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  expect(sidebarOrganizationSnapshot()?.threads[threadKey]?.note).toBe(
    "Waiting on the staging deploy",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => sidebarOrganizationSnapshot()?.threads[threadKey]?.note)
    .toBe("Edited through the sidebar");
  await expect
    .element(page.getByText("Edited through the sidebar", { exact: true }).first())
    .toBeVisible();
  await act(() => emitSidebarMutation({ type: "thread.note", threadKey, note: null }));
  await expect
    .element(page.getByText("Edited through the sidebar", { exact: true }))
    .not.toBeInTheDocument();

  await act(() => emitSidebarMutation({ type: "section.delete", id: "priority" }));
  await expect.element(customSection).not.toBeInTheDocument();
  await expect.element(page.getByText(second.title, { exact: true }).first()).toBeVisible();
  expect(localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY)).toBe(saved);

  await page.getByRole("button", { name: "New section", exact: true }).click();
  await page.getByRole("textbox", { name: "Section name", exact: true }).fill("Created in the UI");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => sidebarOrganizationSnapshot()?.sections.map((section) => section.name))
    .toEqual(["Created in the UI"]);
});
