import { afterEach, assert, it, vi } from "vite-plus/test";

import { resolveDesktopAppId, resolveDesktopProductName } from "../build-desktop-artifact.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("keeps the upstream identity without overrides", () => {
  vi.stubEnv("T3CODE_DESKTOP_APP_ID", "");
  vi.stubEnv("T3CODE_DESKTOP_PRODUCT_NAME", "");
  assert.equal(resolveDesktopAppId(), "com.t3tools.t3code");
  assert.equal(resolveDesktopProductName("0.1.1"), "T3 Code (Beta)");
});

it("uses the Rakesh identity that build.sh sets", () => {
  vi.stubEnv("T3CODE_DESKTOP_APP_ID", "com.rakesh.t3code");
  vi.stubEnv("T3CODE_DESKTOP_PRODUCT_NAME", "T3 Code (Rakesh)");
  assert.equal(resolveDesktopAppId(), "com.rakesh.t3code");
  assert.equal(resolveDesktopProductName("0.1.1"), "T3 Code (Rakesh)");
  assert.equal(resolveDesktopProductName("0.1.2-nightly.20261021.1"), "T3 Code (Rakesh)");
});
