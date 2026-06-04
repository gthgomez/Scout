import { validateReportModel } from "./validators.js";

const VERDICT_ORDER = Object.freeze({ GREEN: 0, YELLOW: 1, GRAY: 2, RED: 3 });

export function createReportModel({
  candidates = [],
  evidence = [],
  decisions = [],
  audit_events = [],
  monitor_events = [],
  command_attempts = [],
}) {
  return validateReportModel({
    generated_at: new Date().toISOString(),
    runtime_safety_status: "Release 1: no clone, no install, no repo scripts, no GitHub writes, no dynamic probes.",
    candidates,
    evidence,
    decisions,
    audit_events,
    monitor_events,
    command_attempts,
  });
}

export function renderMarkdownReport(report) {
  validateReportModel(report);
  const recommended = report.decisions.filter((decision) => ["GREEN", "YELLOW"].includes(decision.verdict));
  const dropped = report.decisions.filter((decision) => decision.verdict === "RED");
  const unknown = report.decisions.filter((decision) => decision.verdict === "GRAY");

  return [
    "# Scout Report",
    "",
    "## Executive Verdict",
    "",
    `Generated: ${report.generated_at}`,
    "",
    `Recommended candidates: ${recommended.length}`,
    `Unknown candidates: ${unknown.length}`,
    `Dropped candidates: ${dropped.length}`,
    "",
    "## Runtime Safety Status",
    "",
    report.runtime_safety_status,
    "",
    renderCommandAttempts(report.command_attempts),
    "",
    "## Recommended Issues",
    "",
    renderRecommendedTable(recommended, report.candidates),
    "",
    "## Dropped Candidates",
    "",
    renderDroppedTable(dropped, report.candidates),
    "",
    "## Evidence Log",
    "",
    renderEvidence(report.evidence),
    "",
    "## Monitor Events",
    "",
    renderMonitorEvents(report.monitor_events),
    "",
    "## Audit Log",
    "",
    renderAuditEvents(report.audit_events),
    "",
    "## Risks And Unknowns",
    "",
    renderUnknowns(unknown),
    "",
    "## Human Next Actions",
    "",
    renderNextActions(recommended),
    "",
  ].join("\n");
}

export function explainCandidate(report, candidateId) {
  validateReportModel(report);

  const candidate = report.candidates.find((item) => item.candidate_id === candidateId);
  const decision = report.decisions.find((item) => item.candidate_id === candidateId);

  if (!candidate) {
    throw new Error(`Unknown candidate id: ${candidateId}`);
  }
  if (!decision) {
    throw new Error(`No triage decision found for candidate: ${candidateId}`);
  }

  const candidateEvidence = report.evidence.filter((item) => item.candidate_id === candidateId);
  const claimEvidenceIds = candidateEvidence.map((item) => item.evidence_id).filter(Boolean);

  const riskClaims = [
    {
      claim: decision.risk_summary ?? "No explicit risk summary provided.",
      status: claimEvidenceIds.length > 0 ? "OBSERVED" : "UNKNOWN",
      evidenceIds: claimEvidenceIds,
    },
    {
      claim: decision.gap_codes.length > 0 ? `Gap flags: ${decision.gap_codes.join(", ")}` : "No known gap codes.",
      status: decision.gap_codes.length > 0 ? "INFERRED" : "OBSERVED",
      evidenceIds: claimEvidenceIds,
    },
    {
      claim: `Setup status is ${decision.setup_status}.`,
      status: decision.setup_status === "static_docs_ok" ? "OBSERVED" : "INFERRED",
      evidenceIds: claimEvidenceIds,
    },
  ];
  if (decision.verdict === "RED" && decision.drop_reason) {
    riskClaims.push({
      claim: `Drop reason: ${decision.drop_reason}`,
      status: "PROPOSED",
      evidenceIds: claimEvidenceIds,
    });
  }

  const lines = [
    "# Candidate Explain",
    "",
    `Candidate: ${candidate.repo_owner}/${candidate.repo_name}#${candidate.issue_number}`,
    `Issue: ${candidate.issue_title}`,
    `Issue URL: ${candidate.issue_url}`,
    "",
    `Verdict: ${decision.verdict}`,
    `Rank: ${decision.rank ?? "n/a"}`,
    `Score: ${decision.score ?? "n/a"}`,
    `Portfolio score: ${decision.portfolio_score ?? "n/a"}`,
    `Risk summary: ${decision.risk_summary ?? ""}`,
    `Drop reason: ${decision.drop_reason ?? "n/a"}`,
    `Human next action: ${decision.human_next_action ?? ""}`,
    "",
    "## Risk Claims",
    ...riskClaims.map(
      (claim) =>
        `- [${claim.status}] ${claim.claim}${` (Evidence IDs: ${claim.evidenceIds.join(", ") || "none"})`}`,
    ),
    "",
  ];

  if (candidateEvidence.length === 0) {
    lines.push("## Evidence", "- No evidence records were collected for this candidate.");
  } else {
    lines.push("## Evidence", ...candidateEvidence.map((item) => `- ${item.evidence_id} [${item.trust_level}]: ${item.claim}`));
  }

  return lines.join("\n");
}

export function exportShortlist(report, options = {}) {
  validateReportModel(report);

  const limit = Number.parseInt(options.limit ?? "50", 10);
  const shortlist = shortlistDecisions(report.decisions)
    .filter((decision) => decision.verdict !== "RED")
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 50);

  const byId = candidateById(report.candidates);

  const lines = ["# Scout Shortlist", "", `Generated: ${new Date().toISOString()}`, "", `Candidates: ${shortlist.length}`, ""];

  if (shortlist.length === 0) {
    lines.push("No shortlist candidates after filtering.");
    return lines.join("\n");
  }

  lines.push(
    "| Rank | Verdict | Repo | Issue | Score | Portfolio | Risk | Setup | Next Action |",
    "| ---: | --- | --- | --- | ---: | ---: | --- | --- | --- |",
  );
  for (const decision of shortlist) {
    const candidate = byId.get(decision.candidate_id);
    lines.push(
      `| ${decision.rank ?? ""} | ${decision.verdict} | ${candidate?.repo_owner ?? "unknown"}/${candidate?.repo_name ?? "unknown"} | ${escapeCell(candidate?.issue_title ?? decision.candidate_id)} | ${decision.score ?? ""} | ${decision.portfolio_score ?? ""} | ${escapeCell(decision.risk_summary ?? "")} | ${decision.setup_status} | ${escapeCell(decision.human_next_action ?? "")} |`,
    );
  }
  return lines.join("\n");
}

function candidateById(candidates) {
  return new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
}

function shortlistDecisions(decisions) {
  return [...decisions].sort((a, b) => {
    const verdictCompare = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict];
    if (verdictCompare !== 0) return verdictCompare;
    return (b.score ?? 0) - (a.score ?? 0);
  });
}

function renderRecommendedTable(decisions, candidates) {
  const byId = candidateById(candidates);
  const rows = [
    "| Rank | Verdict | Repo | Stack | Issue | Link | Score | Portfolio | Risk | Setup Status | Human Next Action |",
    "| ---: | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- |",
  ];
  for (const decision of decisions) {
    const candidate = byId.get(decision.candidate_id);
    rows.push(
      `| ${decision.rank ?? ""} | ${decision.verdict} | ${candidate?.repo_owner}/${candidate?.repo_name} | ${candidate?.primary_language ?? "unknown"} | ${escapeCell(candidate?.issue_title ?? decision.candidate_id)} | ${candidate?.issue_url ?? ""} | ${decision.score ?? ""} | ${decision.portfolio_score ?? ""} | ${escapeCell(decision.risk_summary)} | ${decision.setup_status} | ${escapeCell(decision.human_next_action)} |`,
    );
  }
  return rows.join("\n");
}

function renderDroppedTable(decisions, candidates) {
  const byId = candidateById(candidates);
  const rows = [
    "| Repo | Issue | Drop Reason | Gap Codes |",
    "| --- | --- | --- | --- |",
  ];
  for (const decision of decisions) {
    const candidate = byId.get(decision.candidate_id);
    rows.push(
      `| ${candidate?.repo_owner}/${candidate?.repo_name} | ${escapeCell(candidate?.issue_title ?? decision.candidate_id)} | ${escapeCell(decision.drop_reason ?? "")} | ${decision.gap_codes.join(", ")} |`,
    );
  }
  return rows.join("\n");
}

function renderEvidence(evidence) {
  if (evidence.length === 0) return "- No evidence records beyond candidate metadata were collected.";
  return evidence.map((item) => `- ${item.evidence_id}: [${item.trust_level}] ${item.claim}`).join("\n");
}

function renderCommandAttempts(commandAttempts) {
  if (commandAttempts.length === 0) {
    return "Commands attempted: none. Dynamic execution is not available in Release 1.";
  }
  return [
    "Command attempts:",
    ...commandAttempts.map((item) => `- ${item.candidate_id}: ${item.command} [${item.status}] ${item.reason}`),
  ].join("\n");
}

function renderMonitorEvents(events) {
  if (events.length === 0) return "- No monitor changes recorded.";
  return events.map((event) => `- ${event.candidate_id}: ${event.change_type} (${event.reason})`).join("\n");
}

function renderAuditEvents(events) {
  if (events.length === 0) return "- No audit events recorded.";
  return events.map((event) => `- ${event.operation}: ${event.decision} (${event.reason})`).join("\n");
}

function renderUnknowns(decisions) {
  if (decisions.length === 0) return "- None.";
  return decisions.map((decision) => `- ${decision.candidate_id}: ${decision.risk_summary}`).join("\n");
}

function renderNextActions(decisions) {
  if (decisions.length === 0) return "- No recommended candidates.";
  return decisions.map((decision) => `- ${decision.candidate_id}: ${decision.human_next_action}`).join("\n");
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
