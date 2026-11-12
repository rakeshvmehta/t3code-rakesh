import { describe, expect, it } from "vite-plus/test";

import { isRakeshNightlyVersion } from "./branding.logic";

describe("isRakeshNightlyVersion", () => {
  it.each([
    ["0.1.9", false],
    ["0.1.10-nightly.20261112.4580", true],
    ["0.1.10-preview.20261112.4580", true],
    ["0.1.9+nightly", false],
    ["dev", false],
  ])("detects the nightly channel for %s", (version, expected) => {
    expect(isRakeshNightlyVersion(version)).toBe(expected);
  });
});
