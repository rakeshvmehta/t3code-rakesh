const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

export function resolveAgentMemoryLimits(
  totalBytes: number,
  hasSwap: boolean,
  environment: Readonly<Record<string, string | undefined>>,
): { high: number | "infinity"; max: number; warning?: string } {
  const fallback = {
    high: hasSwap
      ? Math.max(totalBytes - 6 * GiB, Math.floor(totalBytes / 2))
      : ("infinity" as const),
    max: Math.max(totalBytes - 4 * GiB, Math.floor(totalBytes * 0.75)),
  };
  const percentText = environment.T3CODE_AGENT_MEMORY_MAX_PERCENT;
  const reserveText = environment.T3CODE_AGENT_MEMORY_MIN_RESERVE_MIB;
  if (percentText === undefined && reserveText === undefined) return fallback;
  const percent = Number(percentText);
  const reserveMiB = reserveText === undefined ? 1024 : Number(reserveText);
  const max =
    Math.floor(Math.min((totalBytes * percent) / 100, totalBytes - reserveMiB * MiB) / 4096) * 4096;
  if (
    !Number.isFinite(percent) ||
    percent <= 0 ||
    percent >= 100 ||
    !Number.isSafeInteger(reserveMiB) ||
    reserveMiB < 1024 ||
    !Number.isSafeInteger(max) ||
    max < 256 * MiB
  ) {
    return {
      ...fallback,
      warning: "Invalid agent memory policy; retaining default protective limits",
    };
  }
  // Dedicated coding machines use a hard cap without a reclaim throttle.
  return { high: "infinity", max };
}
