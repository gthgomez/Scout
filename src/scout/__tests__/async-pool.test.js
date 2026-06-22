import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapPool, sleep } from "../async-pool.js";

describe("async-pool", () => {
  it("runs mapPool with bounded concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = [1, 2, 3, 4, 5, 6];

    await mapPool(items, 2, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(10);
      inFlight -= 1;
      return item * 2;
    });

    assert.ok(maxInFlight <= 2);
    assert.ok(maxInFlight >= 2);
  });

  it("returns results in order", async () => {
    const results = await mapPool(["a", "b", "c"], 3, async (item) => item.toUpperCase());
    assert.deepEqual(results, ["A", "B", "C"]);
  });
});
