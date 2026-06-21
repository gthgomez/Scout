import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDecisionCockpitModel, renderDecisionCockpitSection } from "../decision-cockpit.js";

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
});
