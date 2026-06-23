import { validateReportModel, resolveRankShortlistBy } from "./validators.js";
import { resolveTriageConfig } from "./triage.js";

const VERDICT_ORDER = Object.freeze({ GREEN: 0, YELLOW: 1, GRAY: 2, RED: 3 });

export function createReportModel({
  run_status = "complete",
  collection_errors = [],
  candidates = [],
  evidence = [],
  decisions = [],
  audit_events = [],
  monitor_events = [],
  command_attempts = [],
  sandbox_runs = [],
  probe_config = null,
  probe_status = "not_requested",
  runtime_safety_status = undefined,
  profile = undefined,
  triage_config = undefined,
  discovery_intent = undefined,
}) {
  const resolvedIntent =
    discovery_intent ?? profile?.discovery_intent ?? triage_config?.discovery_intent ?? "beginner";
  return validateReportModel({
    generated_at: new Date().toISOString(),
    discovery_intent: resolvedIntent,
    run_status,
    runtime_safety_status:
      runtime_safety_status ??
      "No unapproved clone, package install, repo script, GitHub write, or dynamic probe was attempted in this report.",
    triage_config: createTriageConfig(profile, triage_config),
    collection_errors,
    candidates,
    evidence,
    decisions,
    audit_events,
    monitor_events,
    command_attempts,
    sandbox_runs,
    probe_config,
    probe_status,
    ...(profile !== undefined ? { profile } : {}),
  });
}

function createTriageConfig(profile, triageConfig) {
  if (triageConfig) {
    return resolveTriageConfig({
      profile_id: triageConfig.profile_id ?? profile?.profile_id,
      discovery_intent: triageConfig.discovery_intent ?? profile?.discovery_intent,
      threshold_overrides: triageConfig.threshold_overrides ?? profile?.threshold_overrides ?? {},
    });
  }
  return resolveTriageConfig(profile);
}

export function renderMarkdownReport(report) {
  validateReportModel(report);
  const recommended = report.decisions.filter((decision) => ["GREEN", "YELLOW"].includes(decision.verdict));
  const dropped = report.decisions.filter((decision) => decision.verdict === "RED");
  const unknown = report.decisions.filter((decision) => decision.verdict === "GRAY");
  const discoveryIntent = report.discovery_intent ?? "beginner";
  const intentLabel = discoveryIntent === "rewarded" ? "Rewarded contribution hunt" : "Beginner contribution hunt";

  return [
    "# Scout Report",
    "",
    "## Executive Verdict",
    "",
    `Generated: ${report.generated_at}`,
    `Discovery intent: ${discoveryIntent}`,
    `Mission: ${intentLabel}`,
    `Run status: ${report.run_status}`,
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
    "## Probe Results",
    "",
    renderProbeResults(report),
    "",
    "## Recommended Issues",
    "",
    renderRecommendedTable(recommended, report.candidates, report.evidence, discoveryIntent),
    "",
    "## Dropped Candidates",
    "",
    renderDroppedTable(dropped, report.candidates),
    "",
    "## Evidence Log",
    "",
    renderEvidence(report.evidence),
    "",
    "## Collection Errors",
    "",
    renderCollectionErrors(report.collection_errors),
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
  const candidateCommands = report.command_attempts.filter((item) => item.candidate_id === candidateId);
  const claimEvidenceIds = candidateEvidence.map((item) => item.evidence_id).filter(Boolean);
  const setupIntelligence = candidate.static_inspection?.setup_intelligence;

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

  if (setupIntelligence) {
    lines.push(
      "",
      "## Setup Intelligence",
      `- Ecosystems: ${(setupIntelligence.ecosystems ?? []).join(", ") || "unknown"}`,
      `- Package managers: ${(setupIntelligence.package_managers ?? []).join(", ") || "unknown"}`,
      `- Workspace: ${setupIntelligence.workspace?.kind ?? "unknown"}`,
      `- Next evidence action: ${setupIntelligence.recommended_next_evidence_action?.action ?? "unknown"} - ${setupIntelligence.recommended_next_evidence_action?.reason ?? ""}`,
    );
    const denied = setupIntelligence.denied_commands ?? [];
    if (denied.length > 0) {
      lines.push("Denied setup commands:", ...denied.map((item) => `- ${formatCommand(item.command)}: ${formatDeniedContext(item)}${item.reason}`));
    }
  }

  if (candidateCommands.length > 0) {
    lines.push(
      "",
      "## Dynamic Probe Evidence",
      ...candidateCommands.map(
        (item) =>
          `- ${formatCommand(item.command)} [${item.status}] ${item.reason} (approval: ${item.approval_id ?? "n/a"}, sandbox: ${item.sandbox_id ?? "n/a"})`,
      ),
    );
  }

  return lines.join("\n");
}

export function selectShortlistDecisions(report, options = {}) {
  validateReportModel(report);

  const limit = Number.parseInt(options.limit ?? "50", 10);
  const profile = report.profile ?? {};
  const allowedVerdicts = new Set(profile.shortlist_verdicts ?? ["GREEN", "YELLOW", "GRAY"]);
  const byId = candidateById(report.candidates);
  const rankShortlistBy = resolveRankShortlistBy(profile);

  return shortlistDecisions(report.decisions, { rankShortlistBy, candidateById: byId })
    .filter((decision) => decision.verdict !== "RED" && allowedVerdicts.has(decision.verdict))
    .filter((decision) => {
      if (!profile.require_verified_reward) return true;
      const candidate = byId.get(decision.candidate_id);
      return Boolean(candidate?.has_verified_reward_signal);
    })
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 50);
}

export function exportShortlist(report, options = {}) {
  const shortlist = selectShortlistDecisions(report, options);
  const byId = candidateById(report.candidates);

  const discoveryIntent = report.discovery_intent ?? report.decisions[0]?.discovery_intent ?? "beginner";
  const lines = ["# Scout Shortlist", "", `Generated: ${new Date().toISOString()}`, "", `Discovery intent: ${discoveryIntent}`, "", `Candidates: ${shortlist.length}`, ""];

  if (shortlist.length === 0) {
    lines.push("No shortlist candidates after filtering.");
    return lines.join("\n");
  }

  if (discoveryIntent === "rewarded") {
    lines.push(
      "| Rank | Verdict | Repo | Issue | Score | ROI | Effort (h) | Reward Signal | Income Summary | Risk | Next Action |",
      "| ---: | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |",
    );
    for (const decision of shortlist) {
      const candidate = byId.get(decision.candidate_id);
      const rewardSignal = formatRewardSignal(candidate);
      lines.push(
        `| ${decision.rank ?? ""} | ${decision.verdict} | ${candidate?.repo_owner ?? "unknown"}/${candidate?.repo_name ?? "unknown"} | ${escapeCell(candidate?.issue_title ?? decision.candidate_id)} | ${decision.score ?? ""} | ${formatRoiCell(candidate?.roi_score)} | ${formatEffortCell(candidate?.estimated_effort_hours)} | ${escapeCell(rewardSignal)} | ${escapeCell(formatIncomeDisplay(candidate, decision.income_summary))} | ${escapeCell(decision.risk_summary ?? "")} | ${escapeCell(decision.human_next_action ?? "")} |`,
      );
    }
  } else {
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
  }
  return lines.join("\n");
}

function formatNonUsdReward(candidate) {
  if (
    candidate?.reward_currency &&
    candidate.reward_currency !== "USD" &&
    candidate.estimated_reward_amount != null
  ) {
    return `${candidate.estimated_reward_amount} ${candidate.reward_currency} (non-USD; verify payout)`;
  }
  return null;
}

function formatIncomeDisplay(candidate, incomeSummary) {
  const nonUsd = formatNonUsdReward(candidate);
  if (nonUsd) {
    return incomeSummary ? `${nonUsd}; ${incomeSummary}` : nonUsd;
  }
  return incomeSummary ?? "";
}

function formatRewardSignal(candidate) {
  if (!candidate) return "none";
  const nonUsd = formatNonUsdReward(candidate);
  if (nonUsd) return nonUsd;
  if (candidate.has_verified_reward_signal) {
    return (candidate.reward_signals ?? [])
      .filter((signal) => signal.confidence === "OBSERVED")
      .map((signal) => signal.value)
      .join(", ") || "verified";
  }
  if (candidate.has_inferred_reward_signal) return "inferred";
  return "none";
}

function candidateById(candidates) {
  return new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
}

function shortlistDecisions(decisions, options = {}) {
  const rankShortlistBy = options.rankShortlistBy ?? "score";
  const candidateById = options.candidateById ?? new Map();
  return [...decisions].sort((a, b) => {
    const verdictCompare = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict];
    if (verdictCompare !== 0) return verdictCompare;

    const sortKey = (decision) => {
      const candidate = candidateById.get(decision.candidate_id);
      if (rankShortlistBy === "roi") {
        return candidate?.roi_score ?? 0;
      }
      if (rankShortlistBy === "payout") {
        return candidate?.estimated_reward_usd ?? 0;
      }
      return decision.score ?? 0;
    };

    const keyCompare = sortKey(b) - sortKey(a);
    if (keyCompare !== 0) return keyCompare;
    return (b.score ?? 0) - (a.score ?? 0);
  });
}

function formatRoiCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return Number(value).toFixed(2);
}

function formatEffortCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function renderRecommendedTable(decisions, candidates, evidence, discoveryIntent = "beginner") {
  const byId = candidateById(candidates);
  const evidenceByCandidateId = evidenceIdsByCandidate(evidence);
  if (discoveryIntent === "rewarded") {
    const rows = [
      "| Rank | Verdict | Repo | Stack | Issue | Link | Score | Reward Signal | Income Summary | Risk | Evidence IDs | Human Next Action |",
      "| ---: | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- |",
    ];
    for (const decision of decisions) {
      const candidate = byId.get(decision.candidate_id);
      const evidenceIds = evidenceByCandidateId.get(decision.candidate_id) ?? [];
      rows.push(
        `| ${decision.rank ?? ""} | ${decision.verdict} | ${candidate?.repo_owner}/${candidate?.repo_name} | ${candidate?.primary_language ?? "unknown"} | ${escapeCell(candidate?.issue_title ?? decision.candidate_id)} | ${candidate?.issue_url ?? ""} | ${decision.score ?? ""} | ${escapeCell(formatRewardSignal(candidate))} | ${escapeCell(formatIncomeDisplay(candidate, decision.income_summary))} | ${escapeCell(decision.risk_summary)} | ${escapeCell(evidenceIds.join(", "))} | ${escapeCell(decision.human_next_action)} |`,
      );
    }
    return rows.join("\n");
  }

  const rows = [
    "| Rank | Verdict | Repo | Stack | Issue | Link | Score | Portfolio | Risk | Setup Status | Evidence IDs | Human Next Action |",
    "| ---: | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- |",
  ];
  for (const decision of decisions) {
    const candidate = byId.get(decision.candidate_id);
    const evidenceIds = evidenceByCandidateId.get(decision.candidate_id) ?? [];
    rows.push(
      `| ${decision.rank ?? ""} | ${decision.verdict} | ${candidate?.repo_owner}/${candidate?.repo_name} | ${candidate?.primary_language ?? "unknown"} | ${escapeCell(candidate?.issue_title ?? decision.candidate_id)} | ${candidate?.issue_url ?? ""} | ${decision.score ?? ""} | ${decision.portfolio_score ?? ""} | ${escapeCell(decision.risk_summary)} | ${decision.setup_status} | ${escapeCell(evidenceIds.join(", "))} | ${escapeCell(decision.human_next_action)} |`,
    );
  }
  return rows.join("\n");
}

function evidenceIdsByCandidate(evidence) {
  const byCandidate = new Map();
  for (const item of evidence) {
    const existing = byCandidate.get(item.candidate_id) ?? [];
    existing.push(item.evidence_id);
    byCandidate.set(item.candidate_id, existing);
  }
  return byCandidate;
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

function renderCollectionErrors(errors) {
  if (errors.length === 0) return "- None.";
  return errors.map((item) => `- ${item.operation}: ${item.message}`).join("\n");
}

function renderCommandAttempts(commandAttempts) {
  if (commandAttempts.length === 0) {
    return "Commands attempted: none.";
  }
  return [
    "Command attempts:",
    ...commandAttempts.map((item) => `- ${item.candidate_id}: ${formatCommand(item.command)} [${item.status}] ${item.reason}`),
  ].join("\n");
}

function renderProbeResults(report) {
  const probeStatus = report.probe_status ?? "not_requested";
  const lines = [`Probe status: ${probeStatus}`];
  if (report.probe_config) {
    lines.push(
      `Policy: command_set=${report.probe_config.command_set ?? "n/a"}, network=${report.probe_config.network_policy ?? "n/a"}, approval=${report.probe_config.approval_id ?? "n/a"}`,
    );
    const denied = report.probe_config.denied_commands ?? [];
    if (denied.length > 0) {
      lines.push("Denied candidate commands:");
      lines.push(...denied.map((item) => `- ${formatCommand(item.command)}: ${formatDeniedContext(item)}${item.reason}`));
    }
    if (report.probe_config.next_evidence_action) {
      lines.push(
        `Next evidence action: ${report.probe_config.next_evidence_action.action} - ${report.probe_config.next_evidence_action.reason}`,
      );
    }
  }
  const sandboxRuns = report.sandbox_runs ?? [];
  if (sandboxRuns.length > 0) {
    lines.push("Sandbox runs:");
    lines.push(
      ...sandboxRuns.map(
        (run) =>
          `- ${run.sandbox_id}: ${run.lifecycle_status}, image=${run.image_ref}, image_digest=${run.image_digest ?? "unknown"}, network=${run.network_policy}, cleanup=${run.cleanup_status}, limits=${formatResourceLimits(run.resource_limits)}`,
      ),
    );
  }
  if (probeStatus === "not_requested") {
    lines.push("No dynamic probe was requested for this report.");
  }
  return lines.join("\n");
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

function formatCommand(command) {
  if (Array.isArray(command)) {
    return command.join(" ");
  }
  return String(command);
}

function formatDeniedContext(item) {
  const source = [item.source_ref, item.source_range].filter(Boolean).join(" ");
  return source ? `(${source}) ` : "";
}

function formatResourceLimits(limits) {
  if (!limits) return "unknown";
  return [
    `timeout=${limits.timeout_seconds}s`,
    `cpu=${limits.cpu_count}`,
    `memory=${limits.memory_mb}mb`,
    `pids=${limits.pids_limit}`,
    `disk=${limits.disk_mb}mb`,
  ].join("/");
}
