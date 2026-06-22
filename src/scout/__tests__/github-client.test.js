import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGitHubClient } from "../github-client.js";
import { sleep } from "../async-pool.js";

describe("github-client", () => {
  it("backs off when rate limit remaining is low", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      const reset = Math.floor(Date.now() / 1000) + 1;
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name) => {
            const map = {
              "x-ratelimit-limit": "100",
              "x-ratelimit-remaining": calls === 1 ? "5" : "99",
              "x-ratelimit-reset": String(reset),
              "x-ratelimit-resource": "core",
            };
            return map[name.toLowerCase()] ?? null;
          },
        },
        json: async () => ({ ok: true }),
      };
    };

    const client = createGitHubClient({ fetchImpl, cacheEnabled: false, concurrency: 1 });
    await client.fetchJson("https://api.github.com/repos/acme/a");
    await client.fetchJson("https://api.github.com/repos/acme/b");
    assert.equal(calls, 2);
  });

  it("enriches candidates with bounded concurrency", async () => {
    let maxInFlight = 0;
    let inFlight = 0;
    const client = createGitHubClient({
      fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }),
      cacheEnabled: false,
      concurrency: 2,
      enrichMode: "rest",
    });

    await client.enrichCandidates([1, 2, 3, 4], async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(20);
      inFlight -= 1;
      return item;
    });

    assert.ok(maxInFlight <= 2);
  });
});
