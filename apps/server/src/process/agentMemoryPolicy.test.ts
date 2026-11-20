import { describe, expect, it } from "vite-plus/test";
import { resolveAgentMemoryLimits } from "./agentMemoryPolicy.ts";

const GiB = 1024 ** 3;
const dedicated = {
  T3CODE_AGENT_MEMORY_MAX_PERCENT: "85",
  T3CODE_AGENT_MEMORY_MIN_RESERVE_MIB: "1024",
};

describe("agent memory policy", () => {
  it("preserves upstream defaults when no policy is configured", () => {
    expect(resolveAgentMemoryLimits(16 * GiB, true, {})).toEqual({ high: 10 * GiB, max: 12 * GiB });
    expect(resolveAgentMemoryLimits(16 * GiB, false, {})).toEqual({
      high: "infinity",
      max: 12 * GiB,
    });
  });
  it("uses a percentage hard cap without a reclaim throttle", () => {
    expect(resolveAgentMemoryLimits(12 * GiB, true, dedicated)).toEqual({
      high: "infinity",
      max: 10952163328,
    });
    expect(resolveAgentMemoryLimits(12 * GiB, false, dedicated)).toEqual({
      high: "infinity",
      max: 10952163328,
    });
    expect(resolveAgentMemoryLimits(24 * GiB, false, dedicated)).toEqual({
      high: "infinity",
      max: 21904330752,
    });
  });
  it("keeps a minimum system reserve on smaller machines", () => {
    expect(resolveAgentMemoryLimits(4 * GiB, false, dedicated)).toEqual({
      high: "infinity",
      max: 3 * GiB,
    });
  });
  it.each(["", "NaN", "Infinity", "0", "100", "-5", "85x"])(
    "rejects invalid percentage %s without dropping the default hard cap",
    (value) => {
      const result = resolveAgentMemoryLimits(12 * GiB, false, {
        ...dedicated,
        T3CODE_AGENT_MEMORY_MAX_PERCENT: value,
      });
      expect(result.max).toBe(9 * GiB);
      expect(result.high).toBe("infinity");
      expect(result.warning).toBeDefined();
    },
  );
  it.each(["0", "-1", "256", "1023", "NaN", "1024.5"])("rejects invalid reserve %s", (value) => {
    expect(
      resolveAgentMemoryLimits(12 * GiB, false, {
        ...dedicated,
        T3CODE_AGENT_MEMORY_MIN_RESERVE_MIB: value,
      }).warning,
    ).toBeDefined();
  });
  it("rejects an override that leaves too little memory for agents", () => {
    const result = resolveAgentMemoryLimits(GiB, false, dedicated);
    expect(result.max).toBe(0.75 * GiB);
    expect(result.warning).toBeDefined();
  });
});
