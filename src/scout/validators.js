import {
  GAP_CODES,
  MODES,
  SETUP_STATUSES,
  SOURCE_TYPES,
  TRUST_LEVELS,
  VERDICTS,
} from "./types.js";

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function assertString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function assertArray(value, name) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
}

function assertEnum(value, allowed, name) {
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
}

export function validateCandidateIssue(candidate) {
  assertObject(candidate, "CandidateIssue");
  [
    "candidate_id",
    "repo_owner",
    "repo_name",
    "repo_url",
    "issue_title",
    "issue_url",
    "discovered_by_query",
    "collection_status",
  ].forEach((field) => assertString(candidate[field], `CandidateIssue.${field}`));
  if (typeof candidate.issue_number !== "number") {
    throw new Error("CandidateIssue.issue_number must be a number");
  }
  assertArray(candidate.labels, "CandidateIssue.labels");
  assertArray(candidate.assignees, "CandidateIssue.assignees");
  assertArray(candidate.linked_prs, "CandidateIssue.linked_prs");
  assertArray(candidate.source_observations, "CandidateIssue.source_observations");
  assertEnum(candidate.collection_status, ["OBSERVED", "PARTIAL", "FAILED"], "CandidateIssue.collection_status");
  return candidate;
}

export function validateEvidenceItem(evidence) {
  assertObject(evidence, "EvidenceItem");
  ["evidence_id", "candidate_id", "source_ref", "observed_at", "claim", "supports"].forEach((field) =>
    assertString(evidence[field], `EvidenceItem.${field}`),
  );
  assertEnum(evidence.source_type, SOURCE_TYPES, "EvidenceItem.source_type");
  assertEnum(evidence.trust_level, TRUST_LEVELS, "EvidenceItem.trust_level");
  return evidence;
}

export function validateTriageDecision(decision) {
  assertObject(decision, "TriageDecision");
  assertString(decision.candidate_id, "TriageDecision.candidate_id");
  assertEnum(decision.verdict, VERDICTS, "TriageDecision.verdict");
  assertArray(decision.gap_codes, "TriageDecision.gap_codes");
  decision.gap_codes.forEach((gap) => assertEnum(gap, GAP_CODES, "TriageDecision.gap_codes[]"));
  assertString(decision.risk_summary, "TriageDecision.risk_summary");
  assertEnum(decision.setup_status, SETUP_STATUSES, "TriageDecision.setup_status");
  assertString(decision.abandon_criteria, "TriageDecision.abandon_criteria");
  assertString(decision.human_next_action, "TriageDecision.human_next_action");
  if (decision.verdict === "RED" && !decision.drop_reason) {
    throw new Error("TriageDecision.drop_reason is required for RED verdicts");
  }
  return decision;
}

export function validateSearchProfile(profile) {
  assertObject(profile, "SearchProfile");
  ["profile_id", "name", "mode", "created_at", "updated_at"].forEach((field) =>
    assertString(profile[field], `SearchProfile.${field}`),
  );
  assertEnum(profile.mode, MODES.slice(0, 2), "SearchProfile.mode");
  ["languages", "labels", "include_queries", "exclude_orgs", "exclude_repos", "trusted_seed_lists"].forEach((field) =>
    assertArray(profile[field], `SearchProfile.${field}`),
  );
  if (typeof profile.max_candidates !== "number" || profile.max_candidates < 1) {
    throw new Error("SearchProfile.max_candidates must be a positive number");
  }
  return profile;
}

export function validateMonitorEvent(event) {
  assertObject(event, "MonitorEvent");
  ["event_id", "profile_id", "candidate_id", "observed_at", "change_type", "current_verdict", "reason", "human_next_action"].forEach(
    (field) => assertString(event[field], `MonitorEvent.${field}`),
  );
  assertEnum(event.current_verdict, VERDICTS, "MonitorEvent.current_verdict");
  if (event.previous_verdict !== null) {
    assertEnum(event.previous_verdict, VERDICTS, "MonitorEvent.previous_verdict");
  }
  assertEnum(
    event.change_type,
    [
      "new_candidate",
      "verdict_improved",
      "verdict_downgraded",
      "issue_closed",
      "issue_claimed",
      "linked_pr_added",
      "metadata_partial",
    ],
    "MonitorEvent.change_type",
  );
  return event;
}

export function validateAuditEvent(event) {
  assertObject(event, "AuditEvent");
  ["event_id", "timestamp", "operation", "mode", "decision", "reason"].forEach((field) =>
    assertString(event[field], `AuditEvent.${field}`),
  );
  assertEnum(event.decision, ["allowed", "denied", "failed", "observed"], "AuditEvent.decision");
  if (event.candidate_id !== null && event.candidate_id !== undefined) {
    assertString(event.candidate_id, "AuditEvent.candidate_id");
  }
  return event;
}

export function validateCommandAttempt(attempt) {
  assertObject(attempt, "CommandAttempt");
  ["candidate_id", "command", "status", "reason", "observed_at"].forEach((field) =>
    assertString(attempt[field], `CommandAttempt.${field}`),
  );
  assertEnum(attempt.status, ["not_run", "blocked", "failed", "passed"], "CommandAttempt.status");
  return attempt;
}

export function validateReportModel(report) {
  assertObject(report, "ScoutReport");
  assertArray(report.candidates, "ScoutReport.candidates");
  assertArray(report.evidence, "ScoutReport.evidence");
  assertArray(report.decisions, "ScoutReport.decisions");
  assertArray(report.audit_events, "ScoutReport.audit_events");
  assertArray(report.monitor_events, "ScoutReport.monitor_events");
  assertArray(report.command_attempts, "ScoutReport.command_attempts");
  report.candidates.forEach(validateCandidateIssue);
  report.evidence.forEach(validateEvidenceItem);
  report.decisions.forEach(validateTriageDecision);
  report.audit_events.forEach(validateAuditEvent);
  report.monitor_events.forEach(validateMonitorEvent);
  report.command_attempts.forEach(validateCommandAttempt);

  const passedCommandCandidateIds = new Set(
    report.command_attempts.filter((attempt) => attempt.status === "passed").map((attempt) => attempt.candidate_id),
  );
  for (const decision of report.decisions) {
    if (decision.setup_status === "passed" && !passedCommandCandidateIds.has(decision.candidate_id)) {
      throw new Error(`False setup pass claim for ${decision.candidate_id}`);
    }
  }
  return report;
}
