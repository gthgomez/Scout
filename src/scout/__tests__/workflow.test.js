import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  createSessionManifest,
  parseThroughStages,
  resolvePendingStages,
  resolveWorkflowPreset,
} from "../session.js";
import { executeWorkflow } from "../workflow.js";
import { exportHandoffPackages } from "../decision-cockpit.js";

const fixturesPath = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const reportFixtures = JSON.parse(readFileSync(join(fixturesPath, "report-model.json"), "utf8"));

function archiveInspectedCandidate(candidate, overrides = {}) {
  return {
    ...candidate,
    static_inspection_status: "static_docs_ok",
    static_inspection: {
      setup_status: "static_docs_ok",
      file_count: 2,
      total_size_bytes: 1200,
      unsafe_entry_count: 0,
      useful_static_evidence: true,
      setup_intelligence: {
        schema_version: 1,
        ecosystems: ["node"],
        package_managers: ["npm"],
        setup_claims: [
          {
            kind: "setup_docs",
            source_ref: "README.md",
            detail: "README includes setup docs.",
            confidence: "observed",
          },
        ],
        denied_commands: [],
        risk_signals: [],
        recommended_next_evidence_action: {
          action: "readonly_probe",
          reason: "Static setup evidence is present.",
        },
        workspace: {
          kind: "single_package",
          manifest_paths: ["package.json"],
          test_paths: [],
        },
      },
    },
    ...overrides,
  };
}

describe("session manifest", () => {
  it("parses through stages and resolves pending resume stages", () => {
    assert.deepEqual(parseThroughStages("discover,cockpit,handoff"), ["discover", "cockpit", "handoff"]);
    const manifest = createSessionManifest({
      sessionId: "scout_session",
      profile: { name: "test" },
      stagesCompleted: ["discover"],
    });
    assert.deepEqual(resolvePendingStages(manifest), ["static", "cockpit", "handoff"]);
  });

  it("resolves workflow presets to through stages", () => {
    assert.equal(resolveWorkflowPreset("fast"), "discover,cockpit,handoff");
    assert.equal(resolveWorkflowPreset("full"), "discover,static,cockpit,handoff");
  });

  it("records workflow preset metadata on manifest", () => {
    const manifest = createSessionManifest({
      sessionId: "scout_session",
      profile: { name: "test" },
      workflowPresetRequested: "full",
      workflowPresetEffective: "fast",
      staticFetchArchives: false,
    });
    assert.equal(manifest.workflow_preset_requested, "full");
    assert.equal(manifest.workflow_preset_effective, "fast");
    assert.equal(manifest.static_fetch_archives, false);
  });
});

describe("workflow execution", () => {
  it("writes handoff schema 1.1 through discover,cockpit,handoff (fast preset)", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "scout-workflow-"));
    try {
      const report = reportFixtures.validReport;

      const { manifest } = await executeWorkflow({
        outDir,
        profileModel: { name: "test", profile_id: "profile-test", discovery_intent: "beginner" },
        report,
        through: "discover,cockpit,handoff",
        shortlistLimit: 5,
        workflowPresetRequested: "fast",
        workflowPresetEffective: "fast",
        fetchArchives: false,
        renderAgentSummary: () => "# summary",
        createNextActions: () => [],
      });

      const handoff = JSON.parse(readFileSync(join(outDir, "handoff_package.json"), "utf8"));
      assert.equal(handoff.schema_version, "1.1");
      assert.equal(handoff.entrypoint, "handoff_package.json");
      assert.equal(handoff.handoff_mode, "metadata_only");
      assert.equal(handoff.workflow_preset, "fast");
      assert.ok(Array.isArray(handoff.recommended_packages));
      assert.ok(handoff.suggested_commands[0].command.includes("--report"));
      assert.ok(readFileSync(join(outDir, "scout_cockpit.json"), "utf8").includes("SCOUT-alpha-green-1"));
      assert.equal(manifest.workflow_preset_effective, "fast");
      assert.equal(manifest.static_fetch_archives, false);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("runs static stage with mocked archive inspection for full preset", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "scout-workflow-static-"));
    try {
      const report = {
        ...reportFixtures.validReport,
        profile: { shortlist_verdicts: ["GREEN", "YELLOW", "GRAY"] },
      };

      const inspectArchive = async ({ candidate }) => archiveInspectedCandidate(candidate);

      const { manifest } = await executeWorkflow({
        outDir,
        profileModel: { name: "test", profile_id: "profile-test", discovery_intent: "beginner" },
        report,
        through: "discover,static,cockpit,handoff",
        shortlistLimit: 5,
        workflowPresetRequested: "full",
        workflowPresetEffective: "full",
        fetchArchives: true,
        renderAgentSummary: () => "# summary",
        createNextActions: () => [],
        inspectArchive,
      });

      assert.ok(readFileSync(join(outDir, "scout_static_report.json"), "utf8").includes("SCOUT-alpha-green-1"));
      const handoff = JSON.parse(readFileSync(join(outDir, "handoff_package.json"), "utf8"));
      assert.equal(handoff.handoff_mode, "static_verified");
      assert.equal(manifest.static_fetch_archives, true);
      assert.deepEqual(manifest.stages_completed, ["discover", "static", "cockpit", "handoff"]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("tolerates per-candidate archive failures without aborting workflow", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "scout-workflow-static-fail-"));
    try {
      const report = {
        ...reportFixtures.validReport,
        candidates: [
          reportFixtures.validReport.candidates[0],
          {
            ...reportFixtures.validReport.candidates[0],
            candidate_id: "SCOUT-beta-yellow-2",
            issue_number: 13,
            issue_url: "https://github.com/acme/tooling/issues/13",
          },
        ],
        decisions: [
          reportFixtures.validReport.decisions[0],
          {
            ...reportFixtures.validReport.decisions[0],
            candidate_id: "SCOUT-beta-yellow-2",
            verdict: "YELLOW",
            rank: 2,
          },
        ],
        evidence: [
          ...reportFixtures.validReport.evidence,
          {
            evidence_id: "ev-beta",
            candidate_id: "SCOUT-beta-yellow-2",
            source_ref: "https://github.com/acme/tooling/issues/13",
            observed_at: "2026-05-30T00:00:00.000Z",
            claim: "GitHub metadata collected.",
            supports: "candidate metadata and triage input",
            source_type: "GITHUB_API",
            trust_level: "OBSERVED",
          },
        ],
        profile: { shortlist_verdicts: ["GREEN", "YELLOW", "GRAY"] },
      };

      const inspectArchive = async ({ candidate }) => {
        if (candidate.candidate_id === "SCOUT-beta-yellow-2") {
          return {
            ...candidate,
            static_inspection_status: "insufficient_static_evidence",
            collection_status: "PARTIAL",
          };
        }
        return archiveInspectedCandidate(candidate);
      };

      await executeWorkflow({
        outDir,
        profileModel: { name: "test", profile_id: "profile-test", discovery_intent: "beginner" },
        report,
        through: "discover,static,handoff",
        shortlistLimit: 5,
        fetchArchives: true,
        renderAgentSummary: () => "# summary",
        createNextActions: () => [],
        inspectArchive,
      });

      const staticReport = JSON.parse(readFileSync(join(outDir, "scout_static_report.json"), "utf8"));
      const failed = staticReport.candidates.find((item) => item.candidate_id === "SCOUT-beta-yellow-2");
      assert.equal(failed.static_inspection_status, "insufficient_static_evidence");

      const handoff = JSON.parse(readFileSync(join(outDir, "handoff_package.json"), "utf8"));
      assert.equal(handoff.handoff_mode, "static_verified");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("sets metadata_only handoff when full preset archive fetch yields no static evidence", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "scout-workflow-static-all-fail-"));
    try {
      const report = {
        ...reportFixtures.validReport,
        evidence: [
          {
            evidence_id: "ev-meta-1",
            candidate_id: "SCOUT-alpha-green-1",
            source_ref: "https://github.com/acme/tooling/issues/12",
            observed_at: "2026-05-30T00:00:00.000Z",
            claim: "GitHub metadata collected.",
            supports: "candidate metadata and triage input",
            source_type: "GITHUB_API",
            trust_level: "OBSERVED",
          },
        ],
        candidates: reportFixtures.validReport.candidates.map((candidate) => ({
          ...candidate,
          source_observations: [],
          static_inspection_status: "not_inspected",
        })),
        profile: { shortlist_verdicts: ["GREEN", "YELLOW", "GRAY"] },
      };

      const inspectArchive = async ({ candidate }) => ({
        ...candidate,
        static_inspection_status: "insufficient_static_evidence",
        collection_status: "PARTIAL",
      });

      await executeWorkflow({
        outDir,
        profileModel: { name: "test", profile_id: "profile-test", discovery_intent: "beginner" },
        report,
        through: "discover,static,handoff",
        shortlistLimit: 5,
        workflowPresetRequested: "full",
        workflowPresetEffective: "full",
        fetchArchives: true,
        renderAgentSummary: () => "# summary",
        createNextActions: () => [],
        inspectArchive,
      });

      const handoff = JSON.parse(readFileSync(join(outDir, "handoff_package.json"), "utf8"));
      assert.equal(handoff.handoff_mode, "metadata_only");
      assert.ok(handoff.handoff_mode_reason);
      assert.ok(handoff.handoff_mode_reason.includes("archive fetch"));
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe("workflow preset defaults", () => {
  it("fast preset recommends GREEN only when static evidence is low", () => {
    const report = {
      ...reportFixtures.validReport,
      candidates: [
        {
          ...reportFixtures.validReport.candidates[0],
          candidate_id: "SCOUT-green",
        },
        {
          ...reportFixtures.validReport.candidates[0],
          candidate_id: "SCOUT-yellow",
          issue_number: 14,
        },
      ],
      decisions: [
        { ...reportFixtures.validReport.decisions[0], candidate_id: "SCOUT-green", verdict: "GREEN", rank: 1 },
        {
          ...reportFixtures.validReport.decisions[0],
          candidate_id: "SCOUT-yellow",
          verdict: "YELLOW",
          rank: 2,
          gap_codes: ["SOURCE_GAP"],
        },
      ],
      evidence: [],
    };

    const fastHandoff = exportHandoffPackages(report, {
      workflowPresetEffective: "fast",
      handoffMode: "metadata_only",
    });
    assert.deepEqual(fastHandoff.recommended_packages, ["SCOUT-green"]);
  });
});
