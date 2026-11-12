import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The thread route loads ChatView lazily; its first transform would eat the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests, updateClientSettings } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
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

it("keeps saved custom sections separate from project folders when switching modes", async () => {
  await page.viewport(1400, 900);
  const [first, second] = [threadWithHistory("visible", 1), threadWithHistory("assigned", 1)];
  using _environment = installFakeEnvironment([first, second]);
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
});
