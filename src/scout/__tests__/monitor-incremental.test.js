import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildKnownCandidatesMap } from "../monitor.js";
import { discoverCandidates } from "../discovery.js";
import { defaultPolicy } from "../policy.js";

describe("incremental monitor discovery", () => {
  it("reuses known candidates and reduces enrichment fetch calls with --skip-known semantics", async () => {
    let fetchCalls = 0;
    const fetchImpl = async (url) => {
      fetchCalls += 1;
      if (String(url).includes("/search/issues")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({
            items: [
              {
                repository_url: "https://api.github.com/repos/acme/tooling",
                number: 42,
                title: "Fix docs typo",
                html_url: "https://github.com/acme/tooling/issues/42",
                labels: [{ name: "good first issue" }],
                state: "open",
                assignees: [],
                updated_at: "2026-06-02T00:00:00Z",
              },
              {
                repository_url: "https://api.github.com/repos/acme/newrepo",
                number: 7,
                title: "New issue",
                html_url: "https://github.com/acme/newrepo/issues/7",
                labels: [],
                state: "open",
                assignees: [],
                updated_at: "2026-06-05T00:00:00Z",
              },
            ],
          }),
        };
      }
      if (String(url).includes("/repos/acme/newrepo")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ language: "Go", pushed_at: "2026-06-05T00:00:00Z" }),
        };
      }
      if (String(url).includes("/issues/7")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ body: "", comments_url: "https://example.com/comments" }),
        };
      }
      if (String(url).includes("/comments")) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => [] };
      }
      if (String(url).includes("/timeline")) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => [] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const knownCandidates = buildKnownCandidatesMap({
      candidates: [
        {
          candidate_id: "SCOUT-acme-tooling-42",
          repo_owner: "acme",
          repo_name: "tooling",
          issue_number: 42,
          updated_at: "2026-06-02T00:00:00Z",
          collection_status: "OBSERVED",
          primary_language: "TypeScript",
          source_observations: [],
        },
      ],
    });

    const candidates = await discoverCandidates({
      policy: defaultPolicy("metadata_only"),
      queries: ["query"],
      limit: 5,
      fetchImpl,
      knownCandidates,
      enrichMode: "rest",
    });

    assert.equal(candidates.length, 2);
    assert.equal(candidates.find((c) => c.issue_number === 42).primary_language, "TypeScript");
    assert.ok(fetchCalls < 6, `expected fewer fetch calls due to skip-known reuse, got ${fetchCalls}`);
  });
});
