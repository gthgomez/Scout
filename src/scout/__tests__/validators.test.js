import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  validateCandidateIssue,
  validateEvidenceItem,
  validateMonitorEvent,
  validateProbePlan,
  validateReportModel,
  validateSandboxPolicy,
  validateSandboxRun,
  validateSearchProfile,
  validateSetupIntelligence,
  validateTriageDecision,
} from "../validators.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const monitoring = JSON.parse(readFileSync(join(fixturePath, "monitoring.json"), "utf8"));
const profiles = JSON.parse(readFileSync(join(fixturePath, "profiles.json"), "utf8"));
const reports = JSON.parse(readFileSync(join(fixturePath, "report-model.json"), "utf8"));

function makeCandidateIssue(overrides = {}) {
  return {
    candidate_id: "SCOUT-test",
    repo_owner: "acme",
    repo_name: "demo",
    repo_url: "https://github.com/acme/demo",
    issue_title: "Fix contribution docs",
    issue_url: "https://github.com/acme/demo/issues/1",
    discovered_by_query: "is:issue",
    collection_status: "OBSERVED",
    issue_number: 1,
    labels: [],
    assignees: [],
    linked_prs: [],
    source_observations: [],
    ...overrides,
  };
}

function makeEvidence(overrides = {}) {
  return {
    evidence_id: "e1",
    candidate_id: "SCOUT-test",
    source_ref: "README.md",
    observed_at: "2026-05-01T00:00:00.000Z",
    claim: "Claim",
    supports: "true",
    source_type: "STATIC_FILE",
    trust_level: "OBSERVED",
    ...overrides,
  };
}

function makeDecision(overrides = {}) {
  return {
    candidate_id: "SCOUT-test",
    verdict: "GREEN",
    gap_codes: [],
    risk_summary: "No hard drop detected.",
    setup_status: "static_docs_ok",
    abandon_criteria: "Abandon if conditions fail.",
    human_next_action: "Review manually before claim.",
    drop_reason: null,
    score_reasons: ["+25 issue clarity"],
    portfolio_reasons: ["+10 contributor guide"],
    ...overrides,
  };
}

describe("validators", () => {
  it("validates a complete candidate issue model", () => {
    const issue = makeCandidateIssue();
    assert.deepStrictEqual(validateCandidateIssue(issue), issue);
  });

  it("rejects invalid source_type trust boundaries", () => {
    const evidence = makeEvidence({ source_type: "BAD_SOURCE" });
    assert.throws(() => validateEvidenceItem(evidence));
  });

  it("requires RED triage decisions to include drop reasons", () => {
    const decision = makeDecision({ verdict: "RED" });
    assert.throws(() => validateTriageDecision(decision));
    assert.deepStrictEqual(validateTriageDecision({ ...decision, drop_reason: "hard drop", verdict: "RED" }), {
      ...decision,
      drop_reason: "hard drop",
      verdict: "RED",
    });
  });

  it("validates monitor events with previous verdict null", () => {
    const event = monitoring.validMonitorEvent;
    const value = validateMonitorEvent(event);
    assert.equal(value.current_verdict, "GREEN");
    assert.equal(value.previous_verdict, null);
  });

  it("rejects invalid monitor event schemas", () => {
    assert.throws(() => validateMonitorEvent(monitoring.invalidMonitorEvent));
  });

  it("validates valid search profile schema", () => {
    const value = validateSearchProfile(profiles.searchProfile);
    assert.equal(value.mode, "metadata_only");
    assert.equal(value.max_candidates, 30);
  });

  it("rejects unsafe trusted seed-list ids in search profiles", () => {
    assert.throws(
      () =>
        validateSearchProfile({
          ...profiles.searchProfile,
          trusted_seed_lists: ["https://example.test/starter-pack"],
        }),
      /seed-list id/,
    );
  });

  it("loads legacy search profiles without threshold_overrides", () => {
    const value = validateSearchProfile(profiles.searchProfile);

    assert.equal(Object.hasOwn(value, "threshold_overrides"), false);
  });

  it("validates search profile threshold overrides", () => {
    const profile = {
      ...profiles.searchProfile,
      threshold_overrides: {
        green_min_score: 45,
        max_issue_age_days: 730,
      },
    };

    assert.equal(validateSearchProfile(profile).threshold_overrides.green_min_score, 45);
    assert.deepEqual(validateSearchProfile({ ...profiles.searchProfile, threshold_overrides: {} }).threshold_overrides, {});
  });

  it("rejects invalid search profile threshold overrides", () => {
    assert.throws(
      () => validateSearchProfile({ ...profiles.searchProfile, threshold_overrides: { surprise: 1 } }),
      /not a supported threshold/,
    );
    assert.throws(
      () => validateSearchProfile({ ...profiles.searchProfile, threshold_overrides: { green_min_score: Infinity } }),
      /finite number/,
    );
    assert.throws(
      () => validateSearchProfile({ ...profiles.searchProfile, threshold_overrides: { max_issue_age_days: -1 } }),
      /non-negative/,
    );
    assert.throws(
      () => validateSearchProfile({ ...profiles.searchProfile, threshold_overrides: { recent_repo_activity_days: 1.5 } }),
      /integer/,
    );
  });

  it("rejects search profiles with unsupported modes", () => {
    assert.throws(() => validateSearchProfile(profiles.invalidModeProfile));
  });

  it("validates report model with matching command attempts", () => {
    assert.equal(typeof validateReportModel(reports.validReport), "object");
  });

  it("validates Release 2 sandbox policy, probe plan, sandbox run, and argv command attempts", () => {
    const sandboxPolicy = validateSandboxPolicy({
      image: "node:20-alpine",
      network: "none",
      timeout_seconds: 60,
      cpu_count: 1,
      memory_mb: 512,
      pids_limit: 128,
      disk_mb: 256,
      allow_host_home: false,
      allow_ssh_agent: false,
      allow_credential_helper: false,
      allow_docker_socket: false,
      inherit_host_env: false,
      mounts: [],
    });

    assert.equal(validateProbePlan({
      plan_id: "plan-1",
      candidate_id: "SCOUT-test",
      approval_id: "approval-1",
      command_set: "readonly",
      network_policy: "none",
      sandbox_policy: sandboxPolicy,
      source_refs: [{ type: "github_archive", ref: "https://api.github.com/repos/acme/demo/zipball/HEAD" }],
      commands: [["node", "--version"]],
      denied_commands: [
        {
          command: ["npm", "install"],
          reason: "Package installs are blocked.",
          source_ref: "README.md",
          source_range: "L12",
          category: "package_install",
        },
      ],
      next_evidence_action: {
        action: "readonly_probe",
        reason: "Static setup evidence is present.",
      },
      created_at: "2026-06-04T00:00:00.000Z",
    }).command_set, "readonly");

    assert.equal(validateSandboxRun({
      sandbox_id: "sandbox-1",
      image: "node:20-alpine",
      image_ref: "node:20-alpine",
      image_digest: null,
      created_at: "2026-06-04T00:00:00.000Z",
      destroyed_at: "2026-06-04T00:01:00.000Z",
      cleanup_status: "removed",
      lifecycle_status: "destroyed",
      network_policy: "none",
      resource_limits: {
        timeout_seconds: 60,
        cpu_count: 1,
        memory_mb: 512,
        pids_limit: 128,
        disk_mb: 256,
      },
    }).cleanup_status, "removed");

    const report = validateReportModel({
      ...reports.validReport,
      command_attempts: [
        {
          candidate_id: "SCOUT-alpha-green-1",
          command_id: "cmd-node-version",
          command: ["node", "--version"],
          status: "passed",
          reason: "Readonly command completed.",
          observed_at: "2026-06-04T00:00:00.000Z",
          approval_id: "approval-1",
          sandbox_id: "sandbox-1",
          started_at: "2026-06-04T00:00:00.000Z",
          ended_at: "2026-06-04T00:00:01.000Z",
          duration_ms: 1000,
          exit_code: 0,
          stdout_artifact: ".scout/probe/cmd-node-version.stdout.txt",
          stderr_artifact: ".scout/probe/cmd-node-version.stderr.txt",
          result: "passed",
        },
      ],
      sandbox_runs: [],
      probe_status: "complete",
    });

    assert.equal(report.command_attempts[0].command[0], "node");
  });

  it("rejects malformed dynamic probe evidence", () => {
    assert.throws(
      () =>
        validateSandboxPolicy({
          image: "node:20-alpine",
          network: "none",
          timeout_seconds: 0,
          cpu_count: 1,
          memory_mb: 512,
          pids_limit: 128,
          disk_mb: 256,
          allow_host_home: false,
          allow_ssh_agent: false,
          allow_credential_helper: false,
          allow_docker_socket: false,
          inherit_host_env: false,
          mounts: [],
        }),
      /at least 1/,
    );
    assert.throws(
      () =>
        validateReportModel({
          ...reports.validReport,
          command_attempts: [
            {
              candidate_id: "SCOUT-alpha-green-1",
              command: ["node", "--version"],
              status: "passed",
              reason: "Spoofed pass.",
              observed_at: "2026-06-04T00:00:00.000Z",
              exit_code: 1,
            },
          ],
        }),
      /exit_code 0/,
    );
  });

  it("validates setup intelligence schema", () => {
    const intelligence = validateSetupIntelligence({
      schema_version: 1,
      ecosystems: ["node"],
      package_managers: ["npm"],
      workspace: {
        kind: "single_package",
        manifest_paths: ["package.json"],
        test_paths: ["package.json:scripts.test"],
      },
      setup_claims: [
        {
          kind: "setup_docs",
          source_ref: "README.md",
          detail: "README includes setup docs.",
          confidence: "observed",
        },
      ],
      denied_commands: [
        {
          command: ["npm", "install"],
          reason: "Package installs are blocked.",
          source_ref: "README.md",
          source_range: "L4",
          category: "package_install",
        },
      ],
      risk_signals: [],
      recommended_next_evidence_action: {
        action: "readonly_probe",
        reason: "Static setup evidence is present.",
      },
    });

    assert.equal(intelligence.workspace.kind, "single_package");
    assert.throws(
      () =>
        validateSetupIntelligence({
          ...intelligence,
          recommended_next_evidence_action: { action: "install_dependencies", reason: "bad" },
        }),
      /recommended_next_evidence_action.action/,
    );
  });

  it("flags false setup claims in report models", () => {
    assert.throws(() => validateReportModel(reports.falseSetupClaimReport), /False setup pass claim/);
  });

  it("requires recommendation decisions to have candidate evidence", () => {
    const report = {
      ...reports.validReport,
      evidence: [],
    };

    assert.throws(() => validateReportModel(report), /lacks evidence records/);
  });
});
