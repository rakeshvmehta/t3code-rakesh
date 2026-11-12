import "~/index.css";
import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { EMPTY_SIDEBAR_ORGANIZATION } from "@t3tools/contracts/sidebarOrganization";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  rejectNextSidebarImport,
  sidebarImportAttempts,
  sidebarOrganizationSnapshot,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";
import { THREAD_NOTES_STORAGE_KEY } from "./rakesh/threadNotes.logic";
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

it("retries an interrupted import without reloading or discarding the original browser note", async () => {
  await page.viewport(1400, 900);
  const thread = threadWithHistory("retry", 1);
  using _environment = installFakeEnvironment([thread], {
    sidebarOrganization: EMPTY_SIDEBAR_ORGANIZATION,
  });
  const key = `${ENVIRONMENT_ID}:${thread.id}`;
  const stored = JSON.stringify({ [key]: "Keep during reconnect" });
  localStorage.setItem(THREAD_NOTES_STORAGE_KEY, stored);
  using _storage = { [Symbol.dispose]: () => localStorage.removeItem(THREAD_NOTES_STORAGE_KEY) };
  rejectNextSidebarImport();
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    boringSidebarEnabled: false,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });
  await expect.poll(() => sidebarImportAttempts(), { timeout: 10000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => sidebarImportAttempts(), { timeout: 5000 }).toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => sidebarOrganizationSnapshot()?.threads[key]?.note)
    .toBe("Keep during reconnect");
  expect(localStorage.getItem(THREAD_NOTES_STORAGE_KEY)).toBe(stored);
});
