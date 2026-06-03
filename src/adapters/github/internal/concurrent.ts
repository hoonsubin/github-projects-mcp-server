// =============================================================================
// concurrent.ts — Small concurrency helpers for batched GitHub writes/lookups
// =============================================================================

/** Run async work over items with at most `limit` in flight. */
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, Math.min(limit, items.length));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
};
