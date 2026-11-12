import { describe, expect, it } from "vite-plus/test";
import { orderKeyBetween, uniqueOrderKeyBetween } from "./orderKey.ts";

describe("concurrent ordering", () => {
  it.each([
    [null, null],
    ["m", null],
    [null, "b"],
    ["m", "nz"],
    ["abc", "abcd"],
  ] as const)(
    "keeps distinct keys inside %s/%s even when the midpoint is an upper-bound prefix",
    (before, after) => {
      const first = uniqueOrderKeyBetween(before, after, "000001");
      const second = uniqueOrderKeyBetween(before, after, "000002");
      expect(first).not.toBeNull();
      expect(second).not.toBe(first);
      if (before !== null) expect(first! > before).toBe(true);
      if (after !== null) expect(first! < after).toBe(true);
      expect(orderKeyBetween(first!, null)).not.toBeNull();
    },
  );
});
