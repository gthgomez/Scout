import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAcceptanceCriteriaSummary,
  buildSuggestedBranchName,
  extractPlatformClaimInfo,
  getClaimSteps,
  normalizePlatformName,
} from "../claim-steps.js";

describe("claim step templates", () => {
  it("returns platform-specific claim steps", () => {
    const algora = getClaimSteps("algora");
    assert.ok(algora.some((step) => step.includes("Algora")));
    const issuehunt = getClaimSteps("issuehunt");
    assert.ok(issuehunt.some((step) => step.includes("IssueHunt")));
    const opire = getClaimSteps("opire");
    assert.ok(opire.some((step) => step.includes("Opire")));
    const unknown = getClaimSteps("other");
    assert.ok(unknown.some((step) => step.includes("CONTRIBUTING")));
  });

  it("normalizes unknown platform names", () => {
    assert.equal(normalizePlatformName("algora"), "algora");
    assert.equal(normalizePlatformName("ALGORA"), "algora");
    assert.equal(normalizePlatformName("foo"), "unknown");
    assert.equal(normalizePlatformName(null), "unknown");
  });

  it("extracts platform claim info from reward signals", () => {
    const info = extractPlatformClaimInfo([
      { kind: "label", value: "bounty" },
      {
        kind: "platform_url",
        platform: "algora",
        value: "https://algora.io/bounties/demo/1",
      },
    ]);
    assert.equal(info.platform_name, "algora");
    assert.equal(info.platform_claim_url, "https://algora.io/bounties/demo/1");
    assert.deepEqual(extractPlatformClaimInfo([]), {
      platform_claim_url: null,
      platform_name: null,
    });
  });

  it("builds suggested branch names and acceptance summaries", () => {
    assert.equal(buildSuggestedBranchName("Acme", 42), "bounty/acme-42");
    assert.equal(buildSuggestedBranchName("", 1), null);
    assert.equal(
      buildAcceptanceCriteriaSummary({
        has_acceptance_criteria: true,
        issue_body: "Short criteria",
      }),
      "Short criteria",
    );
    assert.equal(
      buildAcceptanceCriteriaSummary({
        has_acceptance_criteria: true,
        issue_body: "x".repeat(600),
      }).length,
      501,
    );
    assert.equal(buildAcceptanceCriteriaSummary({ has_acceptance_criteria: false }), null);
  });
});
