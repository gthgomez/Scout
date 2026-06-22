/**
 * Run fn(item, index) for each item with at most `concurrency` in flight.
 */
export async function mapPool(items, concurrency, fn) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  const limit = Math.max(1, Number(concurrency) || 1);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
