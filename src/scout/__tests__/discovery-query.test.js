import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyQueries,
  isBroadDiscoveryCandidate,
  isPlatformBroadQuery,
  resolveMaxPerQueryForEntry,
} from "../discovery-query.js";

describe("discovery query helpers", () => {
  it("classifies trusted seed body queries as seed partition", () => {
    const queries = [
      { query: "repo:acme/app is:issue state:open label:bounty no:assignee", kind: "trusted_seed_list" },
      {
        query: 'repo:acme/app is:issue state:open "algora.io" in:body no:assignee',
        kind: "trusted_seed_body",
      },
      "is:issue state:open label:algora no:assignee",
    ];
    const { seed, broad } = classifyQueries(queries);
    assert.equal(seed.length, 2);
    assert.equal(broad.length, 1);
  });

  it("treats trusted seed body candidates as non-broad discovery", () => {
    const candidate = {
      discovered_by_query: 'repo:acme/app is:issue state:open "algora.io" in:body no:assignee',
      source_observations: [{ kind: "trusted_seed_body", value: "rewarded-programs-algora", repo: "acme/app" }],
    };
    assert.equal(isBroadDiscoveryCandidate(candidate), false);
  });

  it("detects platform broad queries for per-kind caps", () => {
    assert.equal(isPlatformBroadQuery("is:issue state:open label:algora no:assignee"), true);
    assert.equal(isPlatformBroadQuery('is:issue state:open "opire.dev" in:body no:assignee'), true);
    assert.equal(isPlatformBroadQuery("is:issue state:open label:bounty no:assignee stars:>1000"), false);
  });

  it("applies platform and seed per-query caps from profile", () => {
    const profile = {
      max_issues_per_seed_query: 5,
      max_issues_per_platform_query: 4,
      max_issues_per_broad_query: 1,
    };
    assert.equal(
      resolveMaxPerQueryForEntry(profile, { query: "repo:acme/app is:issue", kind: "trusted_seed_body" }),
      5,
    );
    assert.equal(
      resolveMaxPerQueryForEntry(profile, "is:issue state:open label:algora no:assignee"),
      4,
    );
    assert.equal(
      resolveMaxPerQueryForEntry(profile, "is:issue state:open label:bounty no:assignee stars:>1000"),
      1,
    );
  });
});
