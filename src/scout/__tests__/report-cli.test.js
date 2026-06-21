import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createReportModel, explainCandidate, exportShortlist, renderMarkdownReport } from "../report.js";

const fixturesPath = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const reportFixtures = JSON.parse(readFileSync(join(fixturesPath, "report-model.json"), "utf8"));

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.js");

function createReportFixture(overrides = {}) {
  const report = {
    ...reportFixtures.validReport,
    ...overrides,
  };
  const dir = mkdtempSync(join(tmpdir(), "scout-cli-"));
  const path = join(dir, "scout_report.json");
  writeFileSync(path, JSON.stringify(report, null, 2), "utf8");
  return { dir, path, report };
}

function removeFixture(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8", cwd: options.cwd });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const reason = result.stderr || result.stdout || "";
    throw new Error(reason);
  }
  return result.stdout;
}

describe("report utilities", () => {
  it("explains a candidate with evidence IDs", () => {
    const report = reportFixtures.validReport;
    const output = explainCandidate(report, "SCOUT-alpha-green-1");

    assert.ok(output.includes("Candidate: acme/tooling#12"));
    assert.ok(output.includes("## Risk Claims"));
    assert.match(output, /Evidence IDs:/);
    assert.match(output, /ev-1/);
  });

  it("renders a shortlist markdown artifact", () => {
    const shortlistInput = {
      ...reportFixtures.validReport,
      candidates: [
        ...reportFixtures.validReport.candidates,
        {
          ...reportFixtures.validReport.candidates[0],
          candidate_id: "SCOUT-alpha-gray-1",
          issue_title: "Unknown signal from maintainer",
          issue_number: 99,
          issue_url: "https://github.com/acme/tooling/issues/99",
        },
      ],
      decisions: [
        ...reportFixtures.validReport.decisions,
        {
          candidate_id: "SCOUT-alpha-gray-1",
          verdict: "GRAY",
          rank: 2,
          score: 12,
          portfolio_score: 5,
          gap_codes: ["SOURCE_GAP"],
          risk_summary: "Needs more evidence",
          setup_status: "unknown",
          abandon_criteria: "Abandon if not enough context.",
          human_next_action: "Review evidence gaps before pursuing.",
          drop_reason: null,
          score_reasons: [],
          portfolio_reasons: [],
        },
        {
          candidate_id: "SCOUT-alpha-red-1",
          verdict: "RED",
          rank: null,
          score: -10,
          portfolio_score: 0,
          gap_codes: ["SECURITY_GAP"],
          risk_summary: "Dropped.",
          setup_status: "not_executed",
          abandon_criteria: "Drop.",
          human_next_action: "Drop candidate.",
          drop_reason: "No setup guidance.",
          score_reasons: [],
          portfolio_reasons: [],
        },
      ],
      evidence: [
        ...reportFixtures.validReport.evidence,
        {
          evidence_id: "ev-2",
          candidate_id: "SCOUT-alpha-gray-1",
          source_ref: "CONTRIBUTING.md",
          observed_at: "2026-05-30T00:00:00.000Z",
          claim: "Partial collection path used.",
          supports: "true",
          source_type: "STATIC_FILE",
          trust_level: "INFERRED",
        },
      ],
    };
    const output = exportShortlist(shortlistInput, { limit: 2 });

    assert.ok(output.includes("# Scout Shortlist"));
    assert.ok(output.includes("acme/tooling"));
    assert.ok(!output.includes("SCOUT-alpha-red-1"));
  });

  it("renders evidence IDs in recommended issue rows", () => {
    const output = renderMarkdownReport(reportFixtures.validReport);

    assert.ok(output.includes("Evidence IDs"));
    assert.match(output, /\|\s*ev-1\s*\|/);
  });

  it("adds triage_config with effective thresholds to report JSON models", () => {
    const report = createReportModel({
      ...reportFixtures.validReport,
      profile: {
        profile_id: "profile-open-contribution",
        threshold_overrides: { green_min_score: 101 },
      },
    });

    assert.equal(report.triage_config.profile_id, "profile-open-contribution");
    assert.deepEqual(report.triage_config.threshold_overrides, { green_min_score: 101 });
    assert.equal(report.triage_config.effective_thresholds.green_min_score, 101);
    assert.equal(report.triage_config.effective_thresholds.max_issue_age_days, 365);
  });

  it("renders sandbox image, cleanup, and resource limits in probe results", () => {
    const report = createReportModel({
      ...reportFixtures.validReport,
      sandbox_runs: [
        {
          sandbox_id: "docker-run-1",
          image: "node:20-alpine",
          image_ref: "node:20-alpine",
          image_digest: "node@sha256:abc123",
          created_at: "2026-06-05T00:00:00.000Z",
          destroyed_at: "2026-06-05T00:00:01.000Z",
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
        },
      ],
      probe_status: "complete",
    });

    const output = renderMarkdownReport(report);

    assert.ok(output.includes("image=node:20-alpine"));
    assert.ok(output.includes("image_digest=node@sha256:abc123"));
    assert.ok(output.includes("cleanup=removed"));
    assert.ok(output.includes("limits=timeout=60s/cpu=1/memory=512mb/pids=128/disk=256mb"));
  });
});

describe("report CLI commands", () => {
  it("validates saved reports", () => {
    const { dir, path } = createReportFixture();
    try {
      const output = runCli(["validate-report", "--report", path]);
      assert.ok(output.includes("Report validation passed for"));
      assert.ok(output.includes("Candidates: 1"));
      assert.ok(output.includes("Decisions: 1"));
    } finally {
      removeFixture(dir);
    }
  });

  it("accepts legacy saved reports without run metadata", () => {
    const legacyReport = { ...reportFixtures.validReport };
    delete legacyReport.run_status;
    delete legacyReport.collection_errors;
    const { dir, path } = createReportFixture(legacyReport);
    try {
      const output = runCli(["validate-report", "--report", path]);
      assert.ok(output.includes("Report validation passed for"));
      assert.ok(output.includes("Candidates: 1"));
    } finally {
      removeFixture(dir);
    }
  });

  it("explains candidate decisions from CLI", () => {
    const { dir, path } = createReportFixture();
    try {
      const output = runCli(["explain", "--candidate-id", "SCOUT-alpha-green-1", "--report", path]);
      assert.ok(output.includes("Candidate: acme/tooling#12"));
      assert.ok(output.includes("Evidence IDs: ev-1"));
    } finally {
      removeFixture(dir);
    }
  });

  it("exports shortlist from CLI report input", () => {
    const outDir = mkdtempSync(join(tmpdir(), "scout-cli-"));
    const reportPath = join(outDir, "scout_report.json");
    const outPath = join(outDir, "scout_shortlist.md");
    writeFileSync(reportPath, JSON.stringify(reportFixtures.validReport, null, 2), "utf8");

    try {
      runCli(["export-shortlist", "--report", reportPath, "--out", outPath, "--limit", "3"]);
      const shortlist = readFileSync(outPath, "utf8");
      assert.ok(shortlist.includes("# Scout Shortlist"));
      assert.ok(shortlist.includes("acme/tooling"));
    } finally {
      removeFixture(outDir);
    }
  });

  it("denies probe before sandbox creation when approval id is missing", () => {
    const { dir, path } = createReportFixture();
    try {
      assert.throws(() => {
        runCli(["probe", "--report", path, "--candidate-id", "SCOUT-alpha-green-1"]);
      }, /approval-id/);
    } finally {
      removeFixture(dir);
    }
  });

  it("persists trusted seed lists and threshold overrides from profile create", () => {
    const dir = mkdtempSync(join(tmpdir(), "scout-profile-create-"));
    try {
      const output = runCli(
        [
          "profile",
          "create",
          "seeded-python",
          "--languages",
          "Python",
          "--labels",
          "good first issue",
          "--trusted-seed-lists",
          "starter-pack,jonathan-python",
          "--threshold-overrides",
          "{\"green_min_score\":40}",
          "--max-candidates",
          "3",
        ],
        { cwd: dir },
      );
      const profile = JSON.parse(output);
      const saved = JSON.parse(readFileSync(join(dir, ".scout", "profiles", "seeded-python.json"), "utf8"));

      assert.deepEqual(profile.trusted_seed_lists, ["starter-pack", "jonathan-python"]);
      assert.deepEqual(saved.threshold_overrides, { green_min_score: 40 });
      assert.equal(saved.max_candidates, 3);
    } finally {
      removeFixture(dir);
    }
  });

  it("loads trusted seed lists and emits triage_config during profile run", () => {
    const dir = mkdtempSync(join(tmpdir(), "scout-profile-run-"));
    const profileDir = join(dir, ".scout", "profiles");
    const seedListDir = join(dir, ".scout", "seed-lists");
    const reportPath = join(dir, "scout_report.json");
    mkdirSync(profileDir, { recursive: true });
    mkdirSync(seedListDir, { recursive: true });
    writeFileSync(
      join(profileDir, "seeded.json"),
      JSON.stringify(
        {
          profile_id: "profile-seeded",
          name: "seeded",
          languages: [],
          labels: [],
          include_queries: [],
          exclude_orgs: [],
          exclude_repos: [],
          trusted_seed_lists: ["starter-pack"],
          max_candidates: 1,
          mode: "metadata_only",
          threshold_overrides: { green_min_score: 45 },
          created_at: "2026-06-04T00:00:00.000Z",
          updated_at: "2026-06-04T00:00:00.000Z",
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(seedListDir, "starter-pack.json"),
      JSON.stringify({ seed_list_id: "starter-pack", name: "Starter Pack", repos: [] }, null, 2),
      "utf8",
    );

    try {
      runCli(["profile", "run", "seeded", "--out", reportPath], { cwd: dir });
      const report = JSON.parse(readFileSync(reportPath, "utf8"));

      assert.equal(report.triage_config.profile_id, "profile-seeded");
      assert.deepEqual(report.triage_config.threshold_overrides, { green_min_score: 45 });
      assert.equal(report.triage_config.effective_thresholds.green_min_score, 45);
    } finally {
      removeFixture(dir);
    }
  });

  it("errors when validation report is not valid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "scout-cli-"));
    const path = join(dir, "invalid_report.json");
    writeFileSync(path, "this-is-not-json", "utf8");

    try {
      assert.throws(() => {
        runCli(["validate-report", "--report", path]);
    }, /Unable to parse JSON/);
    } finally {
      removeFixture(dir);
    }
  });

  it("fails validation when candidates lack triage decisions", () => {
    const { dir, path } = createReportFixture({ decisions: [] });
    try {
      assert.throws(() => {
        runCli(["validate-report", "--report", path]);
      }, /lack triage decisions/);
    } finally {
      removeFixture(dir);
    }
  });

  it("writes agent workflow artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "scout-workflow-"));
    const profileDir = join(dir, ".scout", "profiles");
    const outDir = join(dir, "session");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "empty.json"),
      JSON.stringify(
        {
          profile_id: "profile-empty",
          name: "empty",
          languages: [],
          labels: [],
          include_queries: [],
          exclude_orgs: [],
          exclude_repos: [],
          trusted_seed_lists: [],
          max_candidates: 1,
          mode: "metadata_only",
          threshold_overrides: { green_min_score: 41 },
          created_at: "2026-06-04T00:00:00.000Z",
          updated_at: "2026-06-04T00:00:00.000Z",
        },
        null,
        2,
      ),
      "utf8",
    );

    try {
      runCli(["workflow", "run", "--profile", "empty", "--out-dir", outDir], { cwd: dir });
      const report = JSON.parse(readFileSync(join(outDir, "scout_report.json"), "utf8"));
      const summary = readFileSync(join(outDir, "agent_summary.md"), "utf8");
      const legacySummary = readFileSync(join(outDir, "codex_summary.md"), "utf8");
      const nextActions = JSON.parse(readFileSync(join(outDir, "next_actions.json"), "utf8"));

      assert.equal(report.run_status, "complete");
      assert.equal(report.triage_config.profile_id, "profile-empty");
      assert.equal(report.triage_config.effective_thresholds.green_min_score, 41);
      assert.ok(summary.includes("No clone, install, repo script"));
      assert.equal(summary, legacySummary);
      assert.ok(readFileSync(join(outDir, "handoff_package.json"), "utf8").includes("discovery_intent"));
      assert.deepEqual(nextActions, []);
    } finally {
      removeFixture(dir);
    }
  });
});
