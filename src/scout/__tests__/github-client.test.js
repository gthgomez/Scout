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

  it("retries search on secondary rate limit then succeeds", async () => {
    let searchCalls = 0;
    const fetchImpl = async (url) => {
      if (!String(url).includes("/search/issues")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({}),
        };
      }
      searchCalls += 1;
      if (searchCalls === 1) {
        return {
          ok: false,
          status: 403,
          headers: {
            get: (name) => {
              const map = {
                "x-ratelimit-limit": "30",
                "x-ratelimit-remaining": "25",
                "x-ratelimit-resource": "search",
              };
              return map[name.toLowerCase()] ?? null;
            },
          },
          text: async () => "You have exceeded a secondary rate limit.",
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name) => {
            const map = {
              "x-ratelimit-limit": "30",
              "x-ratelimit-remaining": "24",
              "x-ratelimit-resource": "search",
            };
            return map[name.toLowerCase()] ?? null;
          },
        },
        json: async () => ({ total_count: 0, items: [] }),
      };
    };

    const prevPace = process.env.SCOUT_SEARCH_PACE_MS;
    const prevRetries = process.env.SCOUT_SEARCH_MAX_RETRIES;
    process.env.SCOUT_SEARCH_PACE_MS = "0";
    process.env.SCOUT_SEARCH_MAX_RETRIES = "2";
    try {
      const client = createGitHubClient({ fetchImpl, cacheEnabled: false });
      const result = await client.searchIssues("repo:acme/demo is:issue state:open", 1);
      assert.equal(result.body.total_count, 0);
      assert.equal(searchCalls, 2);
    } finally {
      if (prevPace === undefined) delete process.env.SCOUT_SEARCH_PACE_MS;
      else process.env.SCOUT_SEARCH_PACE_MS = prevPace;
      if (prevRetries === undefined) delete process.env.SCOUT_SEARCH_MAX_RETRIES;
      else process.env.SCOUT_SEARCH_MAX_RETRIES = prevRetries;
    }
  });

  it("does not retry search on non-retryable 403", async () => {
    let searchCalls = 0;
    const fetchImpl = async (url) => {
      if (!String(url).includes("/search/issues")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({}),
        };
      }
      searchCalls += 1;
      return {
        ok: false,
        status: 403,
        headers: {
          get: (name) => {
            const map = {
              "x-ratelimit-limit": "30",
              "x-ratelimit-remaining": "25",
              "x-ratelimit-resource": "search",
            };
            return map[name.toLowerCase()] ?? null;
          },
        },
        text: async () => "Bad credentials",
      };
    };

    const prevPace = process.env.SCOUT_SEARCH_PACE_MS;
    const prevRetries = process.env.SCOUT_SEARCH_MAX_RETRIES;
    process.env.SCOUT_SEARCH_PACE_MS = "0";
    process.env.SCOUT_SEARCH_MAX_RETRIES = "3";
    try {
      const client = createGitHubClient({ fetchImpl, cacheEnabled: false });
      await assert.rejects(
        () => client.searchIssues("repo:acme/demo is:issue state:open", 1),
        (error) => error.status === 403 && error.error_kind === "search_failed",
      );
      assert.equal(searchCalls, 1);
    } finally {
      if (prevPace === undefined) delete process.env.SCOUT_SEARCH_PACE_MS;
      else process.env.SCOUT_SEARCH_PACE_MS = prevPace;
      if (prevRetries === undefined) delete process.env.SCOUT_SEARCH_MAX_RETRIES;
      else process.env.SCOUT_SEARCH_MAX_RETRIES = prevRetries;
    }
  });
});
