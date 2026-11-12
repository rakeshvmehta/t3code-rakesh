import { describe, expect, it } from "vite-plus/test";

import { resolveRakeshBrandName } from "./branding.logic";

describe("resolveRakeshBrandName", () => {
  it.each([
    ["0.1.9", "T3-R"],
    ["0.1.10-nightly.20261112.4580", "T3-RN"],
    ["0.1.10-preview.20261112.4580", "T3-RN"],
    ["0.1.9+nightly", "T3-R"],
    ["dev", "T3-R"],
  ])("selects the brand for %s", (version, expected) => {
    expect(resolveRakeshBrandName(version)).toBe(expected);
  });
});
