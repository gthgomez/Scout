import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyRepositoryMetadata } from "../candidate-metadata.js";
import { enrichCandidatesGraphql } from "../github-graphql.js";

describe("github-graphql enrichment", () => {
  it("enriches candidates from GraphQL repository aliases", async () => {
    const candidates = [
      {
        candidate_id: "SCOUT-acme-tooling-42",
        repo_owner: "acme",
        repo_name: "tooling",
        issue_number: 42,
        collection_status: "PARTIAL",
        labels: [],
        source_observations: [],
        linked_prs: [],
      },
    ];

    const graphqlRequest = async () => ({
      body: {
        data: {
          r0: {
            nameWithOwner: "acme/tooling",
            isArchived: false,
            defaultBranchRef: { name: "main" },
            primaryLanguage: { name: "TypeScript" },
            licenseInfo: { spdxId: "MIT" },
            pushedAt: "2026-06-01T00:00:00Z",
            issue: {
              title: "Fix typo",
              body: "bounty $100",
              labels: { nodes: [{ name: "bounty" }] },
              comments: { nodes: [] },
              timelineItems: { nodes: [] },
            },
          },
        },
      },
    });

    let restCalls = 0;
    const enrichOne = async (candidate) => {
      restCalls += 1;
      return candidate;
    };

    const enriched = await enrichCandidatesGraphql(candidates, { graphqlRequest, enrichOne });
    assert.equal(enriched.length, 1);
    assert.equal(enriched[0].primary_language, "TypeScript");
    assert.equal(enriched[0].collection_status, "OBSERVED");
    assert.equal(restCalls, 0);
  });

  it("falls back to REST when GraphQL chunk fails", async () => {
    const candidates = [
      {
        candidate_id: "SCOUT-acme-tooling-42",
        repo_owner: "acme",
        repo_name: "tooling",
        issue_number: 42,
        collection_status: "PARTIAL",
        source_observations: [],
      },
    ];

    const graphqlRequest = async () => {
      throw new Error("graphql down");
    };

    let restCalls = 0;
    const enrichOne = async (candidate) => {
      restCalls += 1;
      return applyRepositoryMetadata(candidate, { language: "Go", pushed_at: "2026-06-01T00:00:00Z" });
    };

    const enriched = await enrichCandidatesGraphql(candidates, { graphqlRequest, enrichOne });
    assert.equal(restCalls, 1);
    assert.equal(enriched[0].primary_language, "Go");
  });
});
