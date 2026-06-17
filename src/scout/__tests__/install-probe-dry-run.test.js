import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createInstallProbeDryRunPlan,
  createTestProbeDesignPlan,
  renderInstallProbeDryRunSection,
  validateInstallProbeDryRunPlan,
  validateTestProbeDesignPlan,
} from "../install-probe-dry-run.js";

const fixturesPath = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const reportFixtures = JSON.parse(readFileSync(join(fixturesPath, "report-model.json"), "utf8"));

function candidateWithIntelligence(intelligence) {
  return {
    ...reportFixtures.validReport.candidates[0],
    static_inspection_status: "static_docs_ok",
    static_inspection: {
      setup_status: "static_docs_ok",
      setup_intelligence: {
        schema_version: 1,
        ecosystems: [],
        package_managers: [],
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
        ...intelligence,
        workspace: {
          kind: "single_package",
          manifest_paths: [],
          test_paths: [],
          ...(intelligence.workspace ?? {}),
        },
      },
    },
  };
}

function reportFor(candidate) {
  return {
    ...reportFixtures.validReport,
    candidates: [candidate],
    evidence: [
      {
        evidence_id: "ev-static",
        candidate_id: candidate.candidate_id,
        source_ref: "README.md",
        observed_at: "2026-06-05T00:00:00.000Z",
        claim: "Static evidence exists.",
        supports: "install dry-run planning",
        source_type: "STATIC_FILE",
        trust_level: "OBSERVED",
      },
    ],
  };
}

function contractFor(candidate, overrides = {}) {
  const repo = `${candidate.repo_owner}/${candidate.repo_name}`;
  const base = {
    contract_id: "r2d-contract-1",
    candidate_id: candidate.candidate_id,
    repo,
    issue: candidate.issue_url,
    network_policy: "registry_allowlist",
    registry_hosts: ["registry.npmjs.org", "pypi.org", "files.pythonhosted.org"],
    command_set: "install_probe_design",
    lifecycle_policy: "scripts_disabled",
    timeout_seconds: 120,
    artifact_retention: "retain_stdout_stderr_7_days",
  };
  const merged = { ...base, ...overrides };
  if (overrides.approval_phrase === undefined) {
    merged.approval_phrase = [
      "APPROVE SCOUT R2D",
      merged.candidate_id,
      merged.repo,
      merged.issue,
      merged.network_policy,
      ...merged.registry_hosts,
      merged.command_set,
      merged.lifecycle_policy,
      String(merged.timeout_seconds),
      merged.artifact_retention,
    ].join(" ");
  }
  return merged;
}

describe("R2E install probe dry-run planning", () => {
  it("builds a Node install dry-run plan from static evidence and an R2D contract", () => {
    const candidate = candidateWithIntelligence({
      ecosystems: ["node"],
      package_managers: ["npm"],
      workspace: { manifest_paths: ["package.json"], test_paths: ["package.json:scripts.test"] },
    });
    const plan = createInstallProbeDryRunPlan(reportFor(candidate), candidate.candidate_id, contractFor(candidate));

    assert.equal(plan.status, "planned");
    assert.equal(plan.execution_status, "not_executed");
    assert.deepEqual(plan.proposed_argv, [["npm", "ci", "--ignore-scripts"]]);
    assert.equal(Object.hasOwn(plan, "command_attempts"), false);
  });

  it("builds a Python install dry-run plan from static evidence and an R2D contract", () => {
    const candidate = candidateWithIntelligence({
      ecosystems: ["python"],
      package_managers: ["pip"],
      workspace: { manifest_paths: ["requirements.txt"] },
    });
    const plan = createInstallProbeDryRunPlan(reportFor(candidate), candidate.candidate_id, contractFor(candidate));

    assert.equal(plan.package_manager, "pip");
    assert.deepEqual(plan.proposed_argv, [["python", "-m", "pip", "install", "-r", "requirements.txt"]]);
  });

  it("rejects dry-run plans without static evidence or matching R2D contract coverage", () => {
    const candidate = candidateWithIntelligence({ ecosystems: ["node"], package_managers: ["npm"] });
    const noStaticReport = { ...reportFor(candidate), evidence: [], candidates: [{ ...candidate, static_inspection_status: "not_requested" }] };

    assert.throws(
      () => createInstallProbeDryRunPlan(noStaticReport, candidate.candidate_id, contractFor(candidate)),
      /static inspection evidence/,
    );
    assert.throws(
      () => createInstallProbeDryRunPlan(reportFor(candidate), candidate.candidate_id, contractFor(candidate, { repo: "other/repo" })),
      /repo must match/,
    );
    assert.throws(
      () => createInstallProbeDryRunPlan(reportFor(candidate), candidate.candidate_id, contractFor(candidate, { approval_phrase: "APPROVE" })),
      /approval_phrase/,
    );
  });

  it("fails closed for lifecycle scripts unless lifecycle policy controls them", () => {
    const candidate = candidateWithIntelligence({
      ecosystems: ["node"],
      package_managers: ["npm"],
      risk_signals: [{ kind: "npm_lifecycle_script", source_ref: "package.json", detail: "package.json defines postinstall." }],
    });
    const failClosed = createInstallProbeDryRunPlan(
      reportFor(candidate),
      candidate.candidate_id,
      contractFor(candidate, { lifecycle_policy: "unsupported_fail_closed" }),
    );
    const controlled = createInstallProbeDryRunPlan(reportFor(candidate), candidate.candidate_id, contractFor(candidate));

    assert.equal(failClosed.status, "unsupported_fail_closed");
    assert.deepEqual(failClosed.proposed_argv, []);
    assert.equal(controlled.status, "planned");
    assert.deepEqual(controlled.proposed_argv, [["npm", "ci", "--ignore-scripts"]]);
  });

  it("renders dry-run commands as proposed and not attempted", () => {
    const candidate = candidateWithIntelligence({ ecosystems: ["node"], package_managers: ["npm"] });
    const output = renderInstallProbeDryRunSection(
      createInstallProbeDryRunPlan(reportFor(candidate), candidate.candidate_id, contractFor(candidate)),
    );

    assert.ok(output.includes("Status: not executed"));
    assert.ok(output.includes("Proposed commands:"));
    assert.ok(output.includes("npm ci --ignore-scripts"));
    assert.ok(output.includes("Command attempts: none"));
    assert.ok(!output.includes("setup_status=passed"));
  });

  it("keeps test probe design blocked behind install probe evidence", () => {
    const candidate = candidateWithIntelligence({
      ecosystems: ["node"],
      package_managers: ["npm"],
      workspace: { manifest_paths: ["package.json"], test_paths: ["package.json:scripts.test"] },
    });
    const installPlan = createInstallProbeDryRunPlan(reportFor(candidate), candidate.candidate_id, contractFor(candidate));
    const testPlan = createTestProbeDesignPlan(reportFor(candidate), candidate.candidate_id, installPlan);

    assert.equal(validateInstallProbeDryRunPlan(installPlan).execution_status, "not_executed");
    assert.equal(validateTestProbeDesignPlan(testPlan).prerequisite, "install_probe_evidence_required");
    assert.equal(testPlan.execution_status, "not_executed");
    assert.deepEqual(testPlan.proposed_argv, [["npm", "test"]]);
  });
});
