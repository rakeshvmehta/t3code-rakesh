/** Deduplicates synchronization writes and retries transient failures while mounted. */
export function createOrganizationRetryQueue(onRetry: () => void = () => {}) {
  const pending = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const attempts = new Map<string, number>();
  let active = true;
  const queue = {
    start() {
      active = true;
    },
    run(key: string, operation: (attempt: number) => Promise<{ readonly _tag: string }>) {
      if (!active || pending.has(key) || timers.has(key)) return;
      pending.add(key);
      const attempt = attempts.get(key) ?? 0;
      const finish = (success: boolean) => {
        pending.delete(key);
        if (success) {
          attempts.delete(key);
        } else if (active) {
          attempts.set(key, attempt + 1);
          timers.set(
            key,
            setTimeout(
              () => {
                timers.delete(key);
                if (active) {
                  onRetry();
                  queue.run(key, operation);
                }
              },
              Math.min(1000 * 2 ** Math.min(attempt, 5), 30000),
            ),
          );
        }
      };
      try {
        void operation(attempt).then(
          (result) => finish(result._tag === "Success"),
          () => finish(false),
        );
      } catch {
        finish(false);
      }
    },
    dispose() {
      active = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
  return queue;
}
