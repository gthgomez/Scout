import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { explainCandidate, exportShortlist } from "../report.js";

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

  it("writes Codex-facing workflow artifacts", () => {
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
          threshold_overrides: {},
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
      const summary = readFileSync(join(outDir, "codex_summary.md"), "utf8");
      const nextActions = JSON.parse(readFileSync(join(outDir, "next_actions.json"), "utf8"));

      assert.equal(report.run_status, "complete");
      assert.ok(summary.includes("No clone, install, repo script"));
      assert.deepEqual(nextActions, []);
    } finally {
      removeFixture(dir);
    }
  });
});
