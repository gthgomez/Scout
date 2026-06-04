import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { hardDropReason, portfolioValueScore, scoreCandidate, triageCandidate, triageCandidates } from "../triage.js";

const fixtures = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "candidates.json"), "utf8"),
);
const NOW = new Date("2026-06-04T00:00:00.000Z");

describe("candidate scoring", () => {
  it("rewards a strong evidence-heavy candidate", () => {
    const result = scoreCandidate(fixtures.greenCandidate, { now: NOW });
    assert.equal(result.score, 100);
    assert.ok(result.reasons.includes("+25 issue clarity"));
    assert.ok(result.reasons.includes("+20 setup docs quality"));
    assert.ok(result.reasons.includes("+15 repo activity"));
    assert.ok(result.reasons.includes("+15 maintainer responsiveness"));
    assert.ok(result.reasons.includes("+10 tests present"));
    assert.ok(result.reasons.includes("+10 stack fit"));
    assert.ok(result.reasons.includes("+5 small file-touch estimate"));
  });

  it("penalizes missing setup docs and private requirements", () => {
    const result = scoreCandidate(
      {
        ...fixtures.privateCredentialCandidate,
        source_observations: [{ kind: "tests_present", value: "Test suite exists" }],
      },
      { now: NOW },
    );
    assert.ok(result.reasons.includes("-25 unclear setup"));
    assert.ok(result.reasons.includes("-30 private credentials required"));
  });

  it("penalizes claimed issues with linked PR and assignment signals", () => {
    const result = scoreCandidate(
      {
        ...fixtures.claimedCandidate,
        linked_prs: [{ likely_solves_issue: true }],
      },
      { now: NOW },
    );
    assert.ok(result.reasons.includes("-40 claimed issue"));
    assert.ok(result.reasons.includes("-50 linked PR likely solves it"));
  });
});

describe("hard drop logic", () => {
  it("returns hard drops for archival and claimed conditions", () => {
    assert.equal(hardDropReason(fixtures.archivedCandidate), "Repository is archived.");
    assert.equal(hardDropReason(fixtures.claimedCandidate), "Issue appears claimed in comments.");
  });

  it("marks hard-drop candidates as RED triage decisions", () => {
    const decision = triageCandidate(fixtures.privateCredentialCandidate, { now: NOW });
    assert.equal(decision.verdict, "RED");
    assert.equal(decision.rank, null);
    assert.equal(decision.setup_status, "not_executed");
    assert.equal(decision.human_next_action, "Drop candidate.");
    assert.equal(decision.gap_codes[0], "SECURITY_GAP");
  });
});

describe("triage ranking", () => {
  it("ranks by verdict and score with RED candidates unranked", () => {
    const candidates = [
      fixtures.greenCandidate,
      fixtures.partialCandidate,
      fixtures.staleCandidate,
      fixtures.archivedCandidate,
    ];

    const ranked = triageCandidates(candidates, { now: NOW });
    assert.equal(ranked[0].verdict, "GREEN");
    assert.equal(ranked[1].verdict, "YELLOW");
    assert.equal(ranked[2].verdict, "GRAY");
    assert.equal(ranked[3].verdict, "RED");
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[1].rank, 2);
    assert.equal(ranked[2].rank, 3);
    assert.equal(ranked[3].rank, null);
  });

  it("returns portfolio scores for decision summaries", () => {
    const decision = triageCandidate(fixtures.greenCandidate, { now: NOW });
    assert.equal(typeof decision.portfolio_score, "number");
    assert.ok(Array.isArray(decision.portfolio_reasons));
    assert.ok(portfolioValueScore(fixtures.greenCandidate).portfolio_reasons.length > 0);
  });
});
