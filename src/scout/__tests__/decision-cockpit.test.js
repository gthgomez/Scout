import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDecisionCockpitModel,
  deriveHandoffMode,
  exportHandoffPackages,
  renderDecisionCockpitSection,
} from "../decision-cockpit.js";

const fixturesPath = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const reportFixtures = JSON.parse(readFileSync(join(fixturesPath, "report-model.json"), "utf8"));

describe("R2G decision cockpit reports", () => {
  it("builds confidence, why-not-GREEN, next action, and handoff fields", () => {
    const report = {
      ...reportFixtures.validReport,
      candidates: [
        {
          ...reportFixtures.validReport.candidates[0],
          collection_status: "PARTIAL",
          latest_maintainer_activity_at: null,
          static_inspection: {
            setup_intelligence: {
              denied_commands: [
                {
                  command: ["npm", "install"],
                  reason: "Package installs are blocked.",
                  source_ref: "README.md",
                  source_range: "L4",
                  category: "package_install",
                },
              ],
              workspace: {
                manifest_paths: ["package.json"],
              },
              recommended_next_evidence_action: {
                action: "readonly_probe",
                reason: "Next safe step is a readonly probe.",
              },
            },
          },
        },
      ],
      decisions: [
        {
          ...reportFixtures.validReport.decisions[0],
          verdict: "YELLOW",
          gap_codes: ["SOURCE_GAP"],
          setup_status: "unknown",
          risk_summary: "Setup evidence is incomplete.",
        },
      ],
      command_attempts: [],
    };

    const model = createDecisionCockpitModel(report);
    const item = model.candidates[0];

    assert.equal(item.confidence.metadata, "low");
    assert.equal(item.confidence.static_evidence, "high");
    assert.equal(item.confidence.sandbox_evidence, "none");
    assert.ok(item.why_not_green.some((reason) => reason.includes("SOURCE_GAP")));
    assert.ok(item.what_would_change_my_mind.some((reason) => reason.includes("readonly probe")));
    assert.equal(item.next_evidence_action.action, "readonly_probe");
    assert.deepEqual(item.handoff_package.suggested_first_files, ["package.json"]);
    assert.ok(item.handoff_package.denied_actions.includes("github_write"));
    assert.ok(item.handoff_package.denied_actions.includes("package_install"));
    assert.equal(Object.hasOwn(item.handoff_package, "branch_name"), false);
  });

  it("renders decision cockpit output for human review without public-action instructions", () => {
    const model = createDecisionCockpitModel(reportFixtures.validReport);
    const output = renderDecisionCockpitSection(model);

    assert.ok(output.includes("## Scout Decision Cockpit"));
    assert.ok(output.includes("Confidence:"));
    assert.ok(output.includes("Why not GREEN:"));
    assert.ok(output.includes("Handoff evidence IDs:"));
    assert.ok(output.includes("Handoff denied actions:"));
    assert.ok(!output.includes("open PR"));
    assert.ok(!output.includes("claim issue"));
  });

  it("filters recommended packages by workflow preset and handoff mode", () => {
    const report = {
      ...reportFixtures.validReport,
      candidates: [
        reportFixtures.validReport.candidates[0],
        {
          ...reportFixtures.validReport.candidates[0],
          candidate_id: "SCOUT-yellow-low-static",
          issue_number: 20,
        },
        {
          ...reportFixtures.validReport.candidates[0],
          candidate_id: "SCOUT-gray",
          issue_number: 21,
        },
      ],
      decisions: [
        { ...reportFixtures.validReport.decisions[0], candidate_id: "SCOUT-alpha-green-1", verdict: "GREEN", rank: 1 },
        {
          ...reportFixtures.validReport.decisions[0],
          candidate_id: "SCOUT-yellow-low-static",
          verdict: "YELLOW",
          rank: 2,
          gap_codes: ["SOURCE_GAP"],
        },
        {
          ...reportFixtures.validReport.decisions[0],
          candidate_id: "SCOUT-gray",
          verdict: "GRAY",
          rank: 3,
        },
      ],
      evidence: reportFixtures.validReport.evidence.filter((item) => item.candidate_id === "SCOUT-alpha-green-1"),
    };

    const fastHandoff = exportHandoffPackages(report, {
      workflowPresetEffective: "fast",
      handoffMode: "metadata_only",
      reportPath: "scout_session/scout_report.json",
      sessionDir: "scout_session",
    });
    assert.deepEqual(fastHandoff.recommended_packages, ["SCOUT-alpha-green-1"]);
    assert.equal(fastHandoff.handoff_mode, "metadata_only");
    assert.ok(fastHandoff.suggested_commands[0].command.includes("scout_session/scout_report.json"));
    assert.ok(!fastHandoff.recommended_packages.includes("SCOUT-gray"));

    const fullHandoff = exportHandoffPackages(report, {
      workflowPresetEffective: "full",
      staticFetchArchives: true,
    });
    assert.equal(fullHandoff.handoff_mode, "static_verified");
    assert.equal(fullHandoff.handoff_mode_reason, null);
    assert.ok(fullHandoff.recommended_packages.includes("SCOUT-alpha-green-1"));
    assert.ok(!fullHandoff.recommended_packages.includes("SCOUT-gray"));
  });

  it("derives handoff mode from static evidence, not preset intent", () => {
    const report = {
      ...reportFixtures.validReport,
      evidence: [],
      decisions: [
        {
          ...reportFixtures.validReport.decisions[0],
          verdict: "GREEN",
        },
      ],
    };

    const fastDerived = deriveHandoffMode(report, { staticFetchArchives: false });
    assert.equal(fastDerived.handoffMode, "metadata_only");
    assert.ok(fastDerived.handoffModeReason.includes("not attempted"));

    const fullFailed = deriveHandoffMode(report, { staticFetchArchives: true });
    assert.equal(fullFailed.handoffMode, "metadata_only");
    assert.ok(fullFailed.handoffModeReason.includes("archive fetch"));

    const fullSucceeded = deriveHandoffMode(reportFixtures.validReport, { staticFetchArchives: true });
    assert.equal(fullSucceeded.handoffMode, "static_verified");
    assert.equal(fullSucceeded.handoffModeReason, null);

    const fullHandoffExport = exportHandoffPackages(report, {
      workflowPresetEffective: "full",
      staticFetchArchives: true,
    });
    assert.equal(fullHandoffExport.handoff_mode, "metadata_only");
    assert.ok(fullHandoffExport.handoff_mode_reason);
  });

  it("shows metadata-only banner after full preset when static evidence is still low", () => {
    const report = {
      ...reportFixtures.validReport,
      evidence: [],
      decisions: [
        {
          ...reportFixtures.validReport.decisions[0],
          verdict: "GREEN",
        },
      ],
    };
    const model = createDecisionCockpitModel(report);
    const output = renderDecisionCockpitSection(model, {
      workflowPresetEffective: "full",
      staticFetchArchives: true,
    });
    assert.ok(output.includes("Metadata-only handoff warning"));
    assert.ok(output.includes("archive fetch"));
  });

  it("shows metadata-only banner when static evidence is low for all recommended candidates", () => {
    const report = {
      ...reportFixtures.validReport,
      evidence: [],
      decisions: [
        {
          ...reportFixtures.validReport.decisions[0],
          verdict: "GREEN",
        },
      ],
    };
    const model = createDecisionCockpitModel(report);
    const output = renderDecisionCockpitSection(model, {
      workflowPresetEffective: "fast",
      staticFetchArchives: false,
    });
    assert.ok(output.includes("Metadata-only handoff warning"));
  });

  it("labels high reward_signal as observed in metadata", () => {
    const report = {
      ...reportFixtures.validReport,
      discovery_intent: "rewarded",
      candidates: [
        {
          ...reportFixtures.validReport.candidates[0],
          has_verified_reward_signal: true,
          has_observed_reward_metadata: true,
          reward_signals: [{ kind: "label", value: "bounty", confidence: "OBSERVED", source_ref: "label:bounty" }],
        },
      ],
    };
    const model = createDecisionCockpitModel(report);
    assert.equal(model.candidates[0].reward_signal_label, "observed in metadata");
    const output = renderDecisionCockpitSection(model);
    assert.ok(output.includes("reward_signal:high (observed in metadata)"));
  });

  it("exports schema 1.2 rewarded handoff with claim workflow fields", () => {
    const report = {
      ...reportFixtures.validReport,
      discovery_intent: "rewarded",
      candidates: [
        {
          ...reportFixtures.validReport.candidates[0],
          has_verified_reward_signal: true,
          has_observed_reward_metadata: true,
          has_acceptance_criteria: true,
          issue_body: "Acceptance: patch the API handler.",
          roi_score: 80,
          estimated_effort_hours: 4,
          claim_friction_score: 60,
          reward_signals: [
            {
              kind: "platform_url",
              platform: "issuehunt",
              value: "https://issuehunt.io/r/issues/999",
              confidence: "OBSERVED",
              source_ref: "issue_body",
            },
          ],
        },
      ],
      decisions: [
        {
          ...reportFixtures.validReport.decisions[0],
          discovery_intent: "rewarded",
          income_summary: "$150 inferred",
        },
      ],
    };

    const handoff = exportHandoffPackages(report, {
      workflowPresetEffective: "fast",
      handoffMode: "metadata_only",
    });
    assert.equal(handoff.schema_version, "1.2");
    assert.equal(handoff.discovery_intent, "rewarded");
    const entry = handoff.packages[0];
    assert.equal(entry.platform_name, "issuehunt");
    assert.equal(entry.payout_verified_externally, false);
    assert.ok(entry.claim_steps.some((step) => step.includes("IssueHunt")));
    assert.equal(entry.roi_score, 80);
    assert.equal(entry.estimated_effort_hours, 4);

    const model = createDecisionCockpitModel(report);
    const output = renderDecisionCockpitSection(model);
    assert.ok(output.includes("ROI score: 80"));
    assert.ok(output.includes("Estimated effort (hours): 4"));
    assert.ok(output.includes("Claim friction score: 60"));
  });

  it("keeps beginner exports on schema 1.1 without claim workflow fields", () => {
    const handoff = exportHandoffPackages(reportFixtures.validReport, {
      workflowPresetEffective: "fast",
    });
    assert.equal(handoff.schema_version, "1.1");
    assert.equal(Object.hasOwn(handoff, "claim_workflow_version"), false);
    const entry = handoff.packages[0];
    assert.equal(Object.hasOwn(entry, "platform_claim_url"), false);
    assert.equal(Object.hasOwn(entry, "claim_steps"), false);
    assert.equal(Object.hasOwn(entry, "roi_score"), false);
  });
});
