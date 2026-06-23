import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { executeWorkflow } from "../workflow.js";

const fixturesPath = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const reportFixtures = JSON.parse(readFileSync(join(fixturesPath, "report-model.json"), "utf8"));

function algoraRewardedReport() {
  const baseCandidate = reportFixtures.validReport.candidates[0];
  const baseDecision = reportFixtures.validReport.decisions[0];
  return {
    ...reportFixtures.validReport,
    discovery_intent: "rewarded",
    profile: {
      discovery_intent: "rewarded",
      rank_shortlist_by: "roi",
      shortlist_verdicts: ["GREEN"],
      green_requires_platform_or_trusted: true,
    },
    candidates: [
      {
        ...baseCandidate,
        has_verified_reward_signal: true,
        has_observed_reward_metadata: true,
        has_acceptance_criteria: true,
        issue_body: "Acceptance: patch the API handler and link the Algora bounty.",
        roi_score: 42,
        roi_score_inferred: 42,
        roi_confidence: "USD",
        estimated_effort_hours: 3,
        claim_friction_score: 70,
        discovery_source: "platform",
        reward_signals: [
          {
            kind: "platform_url",
            platform: "algora",
            value: "https://algora.io/bounties/acme/tooling/12",
            confidence: "OBSERVED",
            source_ref: "issue_body",
          },
        ],
      },
    ],
    decisions: [
      {
        ...baseDecision,
        discovery_intent: "rewarded",
        verdict: "GREEN",
        income_summary: "$120 inferred",
      },
    ],
  };
}

describe("rewarded workflow handoff", () => {
  it("writes schema 1.2 handoff with algora claim_steps through discover,cockpit,handoff", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "scout-workflow-rewarded-"));
    try {
      const report = algoraRewardedReport();

      await executeWorkflow({
        outDir,
        profileModel: {
          name: "rewarded-cash-in",
          profile_id: "profile-rewarded-cash-in",
          discovery_intent: "rewarded",
        },
        report,
        through: "discover,cockpit,handoff",
        shortlistLimit: 5,
        workflowPresetRequested: "fast",
        workflowPresetEffective: "fast",
        fetchArchives: false,
        renderAgentSummary: () => "# rewarded summary",
        createNextActions: () => [],
      });

      const handoff = JSON.parse(readFileSync(join(outDir, "handoff_package.json"), "utf8"));
      assert.equal(handoff.schema_version, "1.2");
      assert.equal(handoff.discovery_intent, "rewarded");
      assert.equal(handoff.claim_workflow_version, "1.0");
      const entry = handoff.packages[0];
      assert.equal(entry.platform_name, "algora");
      assert.equal(entry.platform_claim_url, "https://algora.io/bounties/acme/tooling/12");
      assert.equal(entry.payout_verified_externally, false);
      assert.ok(entry.claim_steps.some((step) => step.includes("Algora")));
      assert.equal(entry.roi_score, 42);
      assert.equal(entry.estimated_effort_hours, 3);
      const cockpit = JSON.parse(readFileSync(join(outDir, "scout_cockpit.json"), "utf8"));
      assert.equal(cockpit.candidates[0].roi_score, 42);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
