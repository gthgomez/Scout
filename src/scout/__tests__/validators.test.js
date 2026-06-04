import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  validateCandidateIssue,
  validateEvidenceItem,
  validateMonitorEvent,
  validateReportModel,
  validateSearchProfile,
  validateTriageDecision,
} from "../validators.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const candidates = JSON.parse(readFileSync(join(fixturePath, "candidates.json"), "utf8"));
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

  it("rejects search profiles with unsupported modes", () => {
    assert.throws(() => validateSearchProfile(profiles.invalidModeProfile));
  });

  it("validates report model with matching command attempts", () => {
    assert.equal(typeof validateReportModel(reports.validReport), "object");
  });

  it("flags false setup claims in report models", () => {
    assert.throws(() => validateReportModel(reports.falseSetupClaimReport), /False setup pass claim/);
  });
});
