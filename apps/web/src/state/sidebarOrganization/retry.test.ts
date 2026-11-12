import { afterEach, expect, it, vi } from "vite-plus/test";
import { createOrganizationRetryQueue } from "./retry";

afterEach(() => vi.useRealTimers());
it("deduplicates pending writes and retries failed migration/cache writes after recovery", async () => {
  vi.useFakeTimers();
  let attempts = 0;
  const operation = async () => ({ _tag: ++attempts === 1 ? "Failure" : "Success" });
  const queue = createOrganizationRetryQueue();
  queue.run("import", operation);
  queue.run("import", operation);
  await Promise.resolve();
  expect(attempts).toBe(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(attempts).toBe(2);
  expect(vi.getTimerCount()).toBe(0);
  queue.dispose();
});
it("cancels scheduled retries when the sidebar unmounts", async () => {
  vi.useFakeTimers();
  const retry = vi.fn();
  const queue = createOrganizationRetryQueue(retry);
  queue.run("cache", async () => ({ _tag: "Failure" }));
  await Promise.resolve();
  queue.dispose();
  await vi.runAllTimersAsync();
  expect(retry).not.toHaveBeenCalled();
});
