import {
  DISCOVERY_INTENTS,
  GAP_CODES,
  MODES,
  RUN_STATUSES,
  SETUP_STATUSES,
  SOURCE_TYPES,
  STATIC_INSPECTION_STATUSES,
  TRUST_LEVELS,
  VERDICTS,
} from "./types.js";
import { HANDOFF_PLATFORM_NAMES } from "./claim-steps.js";
import { validateTrustedSeedListId } from "./seed-lists.js";
import { WORKFLOW_STAGES } from "./session.js";
import { resolveThresholds } from "./triage.js";

export const RANK_SHORTLIST_BY_VALUES = Object.freeze(["roi", "payout", "score"]);

export function resolveRankShortlistBy(profile = {}) {
  if (profile.rank_shortlist_by !== undefined && profile.rank_shortlist_by !== null) {
    assertEnum(profile.rank_shortlist_by, RANK_SHORTLIST_BY_VALUES, "SearchProfile.rank_shortlist_by");
    return profile.rank_shortlist_by;
  }
  if (profile.rank_shortlist_by_payout === true) {
    return "payout";
  }
  return "score";
}

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

function assertOptionalString(value, name) {
  if (value !== null && value !== undefined && typeof value !== "string") {
    throw new Error(`${name} must be a string when present`);
  }
}

function assertArray(value, name) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
}

function assertFiniteInteger(value, name, options = {}) {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${name} must be a finite integer`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`${name} must be at least ${options.min}`);
  }
}

function assertOptionalFiniteInteger(value, name, options = {}) {
  if (value === null || value === undefined) {
    return;
  }
  assertFiniteInteger(value, name, options);
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
  if (candidate.static_inspection_status !== undefined) {
    assertEnum(candidate.static_inspection_status, STATIC_INSPECTION_STATUSES, "CandidateIssue.static_inspection_status");
  }
  if (candidate.static_inspection?.setup_intelligence !== undefined) {
    validateSetupIntelligence(candidate.static_inspection.setup_intelligence);
  }
  return candidate;
}

export function validateCollectionError(error) {
  assertObject(error, "CollectionError");
  ["error_id", "operation", "message", "observed_at"].forEach((field) =>
    assertString(error[field], `CollectionError.${field}`),
  );
  if (error.query !== null && error.query !== undefined) {
    assertString(error.query, "CollectionError.query");
  }
  return error;
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
  if (decision.income_summary !== undefined && decision.income_summary !== null) {
    assertString(decision.income_summary, "TriageDecision.income_summary");
  }
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
  const discoveryIntent = profile.discovery_intent ?? "beginner";
  assertEnum(discoveryIntent, DISCOVERY_INTENTS, "SearchProfile.discovery_intent");
  ["languages", "labels", "include_queries", "exclude_orgs", "exclude_repos", "trusted_seed_lists"].forEach((field) =>
    assertArray(profile[field], `SearchProfile.${field}`),
  );
  profile.trusted_seed_lists.forEach((seedListId) => validateTrustedSeedListId(seedListId));
  if (typeof profile.max_candidates !== "number" || profile.max_candidates < 1) {
    throw new Error("SearchProfile.max_candidates must be a positive number");
  }
  if (profile.threshold_overrides !== undefined) {
    assertObject(profile.threshold_overrides, "SearchProfile.threshold_overrides");
    resolveThresholds(profile.threshold_overrides);
  }
  if (profile.require_verified_reward !== undefined) {
    if (typeof profile.require_verified_reward !== "boolean") {
      throw new Error("SearchProfile.require_verified_reward must be a boolean");
    }
  }
  for (const field of [
    "require_trusted_seed",
    "rank_shortlist_by_payout",
    "queries_prioritize_seeds",
    "interleave_discovery_queries",
    "require_trusted_or_platform_for_broad_green",
    "prefetch_contributing",
    "green_requires_platform_or_trusted",
    "algora_platform_enrich",
    "seed_body_queries",
    "require_unassigned",
  ]) {
    if (profile[field] !== undefined && typeof profile[field] !== "boolean") {
      throw new Error(`SearchProfile.${field} must be a boolean`);
    }
  }
  if (profile.seed_reward_labels !== undefined) {
    assertArray(profile.seed_reward_labels, "SearchProfile.seed_reward_labels");
    profile.seed_reward_labels.forEach((label, index) =>
      assertString(label, `SearchProfile.seed_reward_labels[${index}]`),
    );
  }
  if (profile.rank_shortlist_by !== undefined && profile.rank_shortlist_by !== null) {
    assertEnum(profile.rank_shortlist_by, RANK_SHORTLIST_BY_VALUES, "SearchProfile.rank_shortlist_by");
  }
  for (const field of ["preferred_languages", "excluded_languages"]) {
    if (profile[field] !== undefined) {
      assertArray(profile[field], `SearchProfile.${field}`);
      profile[field].forEach((value, index) => assertString(value, `SearchProfile.${field}[${index}]`));
    }
  }
  assertOptionalFiniteInteger(profile.min_repo_stars, "SearchProfile.min_repo_stars", { min: 0 });
  assertOptionalFiniteInteger(profile.max_repo_stars, "SearchProfile.max_repo_stars", { min: 0 });
  assertOptionalFiniteInteger(profile.max_issues_per_query, "SearchProfile.max_issues_per_query", { min: 1 });
  assertOptionalFiniteInteger(profile.max_issues_per_broad_query, "SearchProfile.max_issues_per_broad_query", {
    min: 1,
  });
  assertOptionalFiniteInteger(profile.max_issues_per_seed_query, "SearchProfile.max_issues_per_seed_query", {
    min: 1,
  });
  assertOptionalFiniteInteger(profile.max_issues_per_platform_query, "SearchProfile.max_issues_per_platform_query", {
    min: 1,
  });
  assertOptionalFiniteInteger(profile.seed_search_max_pages, "SearchProfile.seed_search_max_pages", { min: 1 });
  assertOptionalFiniteInteger(profile.min_seed_candidate_slots, "SearchProfile.min_seed_candidate_slots", { min: 0 });
  assertOptionalFiniteInteger(profile.reserve_broad_query_slots, "SearchProfile.reserve_broad_query_slots", { min: 0 });
  assertOptionalFiniteInteger(profile.broad_green_min_usd, "SearchProfile.broad_green_min_usd", { min: 0 });
  assertOptionalFiniteInteger(profile.search_pace_ms, "SearchProfile.search_pace_ms", { min: 0 });
  assertOptionalFiniteInteger(profile.search_max_retries, "SearchProfile.search_max_retries", { min: 0 });
  assertOptionalFiniteInteger(profile.search_secondary_cooldown_ms, "SearchProfile.search_secondary_cooldown_ms", {
    min: 0,
  });
  if (profile.shortlist_verdicts !== undefined) {
    assertArray(profile.shortlist_verdicts, "SearchProfile.shortlist_verdicts");
    for (const verdict of profile.shortlist_verdicts) {
      assertEnum(verdict, VERDICTS, "SearchProfile.shortlist_verdicts[]");
    }
  }
  if (profile.repo_size_filter !== undefined && profile.repo_size_filter !== null) {
    assertString(profile.repo_size_filter, "SearchProfile.repo_size_filter");
  }
  return {
    ...profile,
    discovery_intent: discoveryIntent,
    require_verified_reward: profile.require_verified_reward ?? false,
    require_trusted_seed: profile.require_trusted_seed ?? false,
    rank_shortlist_by_payout: profile.rank_shortlist_by_payout ?? false,
    rank_shortlist_by: resolveRankShortlistBy(profile),
    preferred_languages: profile.preferred_languages ?? [],
    excluded_languages: profile.excluded_languages ?? [],
    min_repo_stars: profile.min_repo_stars ?? null,
    max_repo_stars: profile.max_repo_stars ?? null,
    queries_prioritize_seeds: profile.queries_prioritize_seeds ?? false,
    seed_reward_labels: profile.seed_reward_labels ?? [],
    max_issues_per_query: profile.max_issues_per_query ?? null,
    max_issues_per_broad_query: profile.max_issues_per_broad_query ?? null,
    min_seed_candidate_slots: profile.min_seed_candidate_slots ?? null,
    interleave_discovery_queries: profile.interleave_discovery_queries ?? false,
    reserve_broad_query_slots: profile.reserve_broad_query_slots ?? null,
    broad_green_min_usd: profile.broad_green_min_usd ?? null,
    require_trusted_or_platform_for_broad_green: profile.require_trusted_or_platform_for_broad_green ?? false,
    green_requires_platform_or_trusted: profile.green_requires_platform_or_trusted ?? false,
    shortlist_verdicts: profile.shortlist_verdicts ?? ["GREEN", "YELLOW", "GRAY"],
    repo_size_filter: profile.repo_size_filter ?? null,
    prefetch_contributing: profile.prefetch_contributing ?? false,
    algora_platform_enrich: profile.algora_platform_enrich ?? false,
    seed_body_queries: profile.seed_body_queries ?? false,
    require_unassigned: profile.require_unassigned ?? true,
    search_pace_ms: profile.search_pace_ms ?? null,
    search_max_retries: profile.search_max_retries ?? null,
    search_secondary_cooldown_ms: profile.search_secondary_cooldown_ms ?? null,
  };
}

export function validateTriageConfig(config) {
  assertObject(config, "ScoutReport.triage_config");
  assertString(config.profile_id, "ScoutReport.triage_config.profile_id");
  assertObject(config.threshold_overrides, "ScoutReport.triage_config.threshold_overrides");
  assertObject(config.effective_thresholds, "ScoutReport.triage_config.effective_thresholds");
  if (config.discovery_intent !== undefined) {
    assertEnum(config.discovery_intent, DISCOVERY_INTENTS, "ScoutReport.triage_config.discovery_intent");
  }
  resolveThresholds(config.threshold_overrides);
  resolveThresholds(config.effective_thresholds);
  return config;
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
      "candidate_missing",
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

export function validateSandboxPolicy(policy) {
  assertObject(policy, "SandboxPolicy");
  assertString(policy.image, "SandboxPolicy.image");
  assertEnum(policy.network, ["none", "registry_allowlist"], "SandboxPolicy.network");
  if (policy.network === "registry_allowlist") {
    assertArray(policy.registry_hosts, "SandboxPolicy.registry_hosts");
    if (policy.registry_hosts.length === 0) {
      throw new Error("SandboxPolicy.registry_hosts must not be empty when network is registry_allowlist");
    }
    policy.registry_hosts.forEach((host, index) => {
      if (typeof host !== "string" || host.length === 0) {
        throw new Error(`SandboxPolicy.registry_hosts[${index}] must be a non-empty string`);
      }
    });
  }
  assertFiniteInteger(policy.timeout_seconds, "SandboxPolicy.timeout_seconds", { min: 1 });
  assertFiniteInteger(policy.cpu_count, "SandboxPolicy.cpu_count", { min: 1 });
  assertFiniteInteger(policy.memory_mb, "SandboxPolicy.memory_mb", { min: 1 });
  assertFiniteInteger(policy.pids_limit, "SandboxPolicy.pids_limit", { min: 1 });
  assertFiniteInteger(policy.disk_mb, "SandboxPolicy.disk_mb", { min: 1 });
  [
    "allow_host_home",
    "allow_ssh_agent",
    "allow_credential_helper",
    "allow_docker_socket",
    "inherit_host_env",
  ].forEach((field) => {
    if (typeof policy[field] !== "boolean") {
      throw new Error(`SandboxPolicy.${field} must be a boolean`);
    }
  });
  assertArray(policy.mounts, "SandboxPolicy.mounts");
  return policy;
}

export function validateProbePlan(plan) {
  assertObject(plan, "ProbePlan");
  ["plan_id", "candidate_id", "approval_id", "command_set", "network_policy", "created_at"].forEach((field) =>
    assertString(plan[field], `ProbePlan.${field}`),
  );
  assertEnum(plan.network_policy, ["none", "registry_allowlist"], "ProbePlan.network_policy");
  assertEnum(plan.command_set, ["readonly", "install_probe", "test_probe"], "ProbePlan.command_set");
  validateSandboxPolicy(plan.sandbox_policy);
  assertArray(plan.source_refs, "ProbePlan.source_refs");
  assertArray(plan.commands, "ProbePlan.commands");
  assertArray(plan.denied_commands, "ProbePlan.denied_commands");
  plan.source_refs.forEach((sourceRef, index) => {
    assertObject(sourceRef, `ProbePlan.source_refs[${index}]`);
    assertString(sourceRef.type, `ProbePlan.source_refs[${index}].type`);
    assertString(sourceRef.ref, `ProbePlan.source_refs[${index}].ref`);
  });
  plan.commands.forEach((command, index) => validateArgv(command, `ProbePlan.commands[${index}]`));
  plan.denied_commands.forEach((denied, index) => {
    validateDeniedCommand(denied, `ProbePlan.denied_commands[${index}]`);
  });
  if (plan.next_evidence_action !== undefined) {
    validateNextEvidenceAction(plan.next_evidence_action, "ProbePlan.next_evidence_action");
  }
  return plan;
}

export function validateSandboxRun(run) {
  assertObject(run, "SandboxRun");
  ["sandbox_id", "image", "image_ref", "created_at", "cleanup_status", "lifecycle_status", "network_policy"].forEach((field) =>
    assertString(run[field], `SandboxRun.${field}`),
  );
  assertOptionalString(run.destroyed_at, "SandboxRun.destroyed_at");
  assertOptionalString(run.image_digest, "SandboxRun.image_digest");
  assertEnum(run.network_policy, ["none", "registry_allowlist"], "SandboxRun.network_policy");
  assertObject(run.resource_limits, "SandboxRun.resource_limits");
  assertFiniteInteger(run.resource_limits.timeout_seconds, "SandboxRun.resource_limits.timeout_seconds", { min: 1 });
  assertFiniteInteger(run.resource_limits.cpu_count, "SandboxRun.resource_limits.cpu_count", { min: 1 });
  assertFiniteInteger(run.resource_limits.memory_mb, "SandboxRun.resource_limits.memory_mb", { min: 1 });
  assertFiniteInteger(run.resource_limits.pids_limit, "SandboxRun.resource_limits.pids_limit", { min: 1 });
  assertFiniteInteger(run.resource_limits.disk_mb, "SandboxRun.resource_limits.disk_mb", { min: 1 });
  return run;
}

export function validateCommandAttempt(attempt) {
  assertObject(attempt, "CommandAttempt");
  ["candidate_id", "status", "reason", "observed_at"].forEach((field) =>
    assertString(attempt[field], `CommandAttempt.${field}`),
  );
  if (Array.isArray(attempt.command)) {
    validateArgv(attempt.command, "CommandAttempt.command");
  } else {
    assertString(attempt.command, "CommandAttempt.command");
  }
  assertEnum(attempt.status, ["not_run", "blocked", "failed", "passed"], "CommandAttempt.status");
  assertOptionalString(attempt.command_id, "CommandAttempt.command_id");
  assertOptionalString(attempt.approval_id, "CommandAttempt.approval_id");
  assertOptionalString(attempt.sandbox_id, "CommandAttempt.sandbox_id");
  assertOptionalString(attempt.source_ref, "CommandAttempt.source_ref");
  assertOptionalString(attempt.started_at, "CommandAttempt.started_at");
  assertOptionalString(attempt.ended_at, "CommandAttempt.ended_at");
  assertOptionalString(attempt.stdout_artifact, "CommandAttempt.stdout_artifact");
  assertOptionalString(attempt.stderr_artifact, "CommandAttempt.stderr_artifact");
  assertOptionalString(attempt.result, "CommandAttempt.result");
  if (attempt.duration_ms !== undefined) {
    assertFiniteInteger(attempt.duration_ms, "CommandAttempt.duration_ms", { min: 0 });
  }
  if (attempt.exit_code !== undefined && attempt.exit_code !== null) {
    assertFiniteInteger(attempt.exit_code, "CommandAttempt.exit_code");
  }
  if (attempt.status === "passed" && attempt.exit_code !== undefined && attempt.exit_code !== 0) {
    throw new Error("CommandAttempt.status passed requires exit_code 0");
  }
  return attempt;
}

export function validateReportModel(report) {
  assertObject(report, "ScoutReport");
  assertEnum(report.run_status, RUN_STATUSES, "ScoutReport.run_status");
  assertArray(report.collection_errors, "ScoutReport.collection_errors");
  if (report.discovery_query_stats !== undefined) {
    assertArray(report.discovery_query_stats, "ScoutReport.discovery_query_stats");
    for (const [index, stat] of report.discovery_query_stats.entries()) {
      assertObject(stat, `ScoutReport.discovery_query_stats[${index}]`);
      assertString(stat.query ?? "", `ScoutReport.discovery_query_stats[${index}].query`);
    }
  }
  assertArray(report.candidates, "ScoutReport.candidates");
  assertArray(report.evidence, "ScoutReport.evidence");
  assertArray(report.decisions, "ScoutReport.decisions");
  assertArray(report.audit_events, "ScoutReport.audit_events");
  assertArray(report.monitor_events, "ScoutReport.monitor_events");
  assertArray(report.command_attempts, "ScoutReport.command_attempts");
  if (report.sandbox_runs !== undefined) {
    assertArray(report.sandbox_runs, "ScoutReport.sandbox_runs");
    report.sandbox_runs.forEach(validateSandboxRun);
  }
  if (report.probe_config !== undefined && report.probe_config !== null) {
    assertObject(report.probe_config, "ScoutReport.probe_config");
    ["approval_id", "candidate_id", "command_set", "network_policy"].forEach((field) => {
      if (report.probe_config[field] !== undefined) {
        assertString(report.probe_config[field], `ScoutReport.probe_config.${field}`);
      }
    });
    if (report.probe_config.command_set !== undefined) {
      assertEnum(report.probe_config.command_set, ["readonly", "install_probe", "test_probe"], "ScoutReport.probe_config.command_set");
    }
    if (report.probe_config.network_policy !== undefined) {
      assertEnum(report.probe_config.network_policy, ["none", "registry_allowlist"], "ScoutReport.probe_config.network_policy");
    }
    if (report.probe_config.sandbox_policy !== undefined) {
      validateSandboxPolicy(report.probe_config.sandbox_policy);
    }
    if (report.probe_config.denied_commands !== undefined) {
      assertArray(report.probe_config.denied_commands, "ScoutReport.probe_config.denied_commands");
      report.probe_config.denied_commands.forEach((denied, index) => {
        validateDeniedCommand(denied, `ScoutReport.probe_config.denied_commands[${index}]`);
      });
    }
    if (report.probe_config.next_evidence_action !== undefined) {
      validateNextEvidenceAction(report.probe_config.next_evidence_action, "ScoutReport.probe_config.next_evidence_action");
    }
  }
  if (report.probe_status !== undefined) {
    assertEnum(report.probe_status, ["not_requested", "blocked", "complete", "partial", "failed"], "ScoutReport.probe_status");
  }
  if (report.triage_config !== undefined) {
    validateTriageConfig(report.triage_config);
  }
  report.candidates.forEach(validateCandidateIssue);
  report.collection_errors.forEach(validateCollectionError);
  report.evidence.forEach(validateEvidenceItem);
  report.decisions.forEach(validateTriageDecision);
  report.audit_events.forEach(validateAuditEvent);
  report.monitor_events.forEach(validateMonitorEvent);
  report.command_attempts.forEach(validateCommandAttempt);

  const passedCommandCandidateIds = new Set(
    report.command_attempts
      .filter((attempt) => attempt.status === "passed" && (attempt.exit_code === undefined || attempt.exit_code === 0))
      .map((attempt) => attempt.candidate_id),
  );
  const evidenceCandidateIds = new Set(report.evidence.map((evidence) => evidence.candidate_id));
  for (const decision of report.decisions) {
    if (decision.setup_status === "passed" && !passedCommandCandidateIds.has(decision.candidate_id)) {
      throw new Error(`False setup pass claim for ${decision.candidate_id}`);
    }
    if (["GREEN", "YELLOW"].includes(decision.verdict) && !evidenceCandidateIds.has(decision.candidate_id)) {
      throw new Error(`Recommended candidate lacks evidence records: ${decision.candidate_id}`);
    }
  }
  return report;
}

export function validateSetupIntelligence(intelligence) {
  assertObject(intelligence, "SetupIntelligence");
  if (intelligence.schema_version !== undefined) {
    assertFiniteInteger(intelligence.schema_version, "SetupIntelligence.schema_version", { min: 1 });
  }
  ["ecosystems", "package_managers", "setup_claims", "denied_commands", "risk_signals"].forEach((field) =>
    assertArray(intelligence[field], `SetupIntelligence.${field}`),
  );
  assertObject(intelligence.workspace, "SetupIntelligence.workspace");
  assertEnum(
    intelligence.workspace.kind,
    ["single_package", "monorepo", "docs_only", "unknown"],
    "SetupIntelligence.workspace.kind",
  );
  assertArray(intelligence.workspace.manifest_paths, "SetupIntelligence.workspace.manifest_paths");
  assertArray(intelligence.workspace.test_paths, "SetupIntelligence.workspace.test_paths");
  intelligence.ecosystems.forEach((item, index) => assertString(item, `SetupIntelligence.ecosystems[${index}]`));
  intelligence.package_managers.forEach((item, index) => assertString(item, `SetupIntelligence.package_managers[${index}]`));
  intelligence.workspace.manifest_paths.forEach((item, index) =>
    assertString(item, `SetupIntelligence.workspace.manifest_paths[${index}]`),
  );
  intelligence.workspace.test_paths.forEach((item, index) =>
    assertString(item, `SetupIntelligence.workspace.test_paths[${index}]`),
  );
  intelligence.setup_claims.forEach((claim, index) => {
    assertObject(claim, `SetupIntelligence.setup_claims[${index}]`);
    ["kind", "source_ref", "detail", "confidence"].forEach((field) =>
      assertString(claim[field], `SetupIntelligence.setup_claims[${index}].${field}`),
    );
  });
  intelligence.denied_commands.forEach((command, index) =>
    validateDeniedCommand(command, `SetupIntelligence.denied_commands[${index}]`),
  );
  intelligence.risk_signals.forEach((signal, index) => {
    assertObject(signal, `SetupIntelligence.risk_signals[${index}]`);
    ["kind", "source_ref", "detail"].forEach((field) =>
      assertString(signal[field], `SetupIntelligence.risk_signals[${index}].${field}`),
    );
  });
  validateNextEvidenceAction(intelligence.recommended_next_evidence_action, "SetupIntelligence.recommended_next_evidence_action");
  return intelligence;
}

function validateDeniedCommand(denied, name) {
  assertObject(denied, name);
  validateArgv(denied.command, `${name}.command`);
  assertString(denied.reason, `${name}.reason`);
  assertOptionalString(denied.source_ref, `${name}.source_ref`);
  assertOptionalString(denied.source_range, `${name}.source_range`);
  assertOptionalString(denied.category, `${name}.category`);
  return denied;
}

function validateNextEvidenceAction(action, name) {
  assertObject(action, name);
  assertEnum(action.action, ["drop", "human_review", "static_inspection", "readonly_probe", "no_action"], `${name}.action`);
  assertString(action.reason, `${name}.reason`);
  return action;
}

function validateArgv(command, name) {
  assertArray(command, name);
  if (command.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  command.forEach((part, index) => assertString(part, `${name}[${index}]`));
  return command;
}

const HANDOFF_MODES = Object.freeze(["metadata_only", "static_verified"]);
const WORKFLOW_PRESETS = Object.freeze(["fast", "full"]);
const HANDOFF_SCHEMA_VERSIONS = Object.freeze(["1.1", "1.2"]);

export function validateHandoffPackage(handoff) {
  assertObject(handoff, "HandoffPackage");
  assertString(handoff.schema_version, "HandoffPackage.schema_version");
  if (!HANDOFF_SCHEMA_VERSIONS.includes(handoff.schema_version)) {
    throw new Error("HandoffPackage.schema_version must be 1.1 or 1.2");
  }
  if (handoff.entrypoint !== "handoff_package.json") {
    throw new Error("HandoffPackage.entrypoint must be handoff_package.json");
  }
  assertString(handoff.generated_at, "HandoffPackage.generated_at");
  assertEnum(handoff.discovery_intent, DISCOVERY_INTENTS, "HandoffPackage.discovery_intent");
  assertEnum(handoff.handoff_mode, HANDOFF_MODES, "HandoffPackage.handoff_mode");
  if (handoff.handoff_mode_reason !== null && handoff.handoff_mode_reason !== undefined) {
    assertString(handoff.handoff_mode_reason, "HandoffPackage.handoff_mode_reason");
  }
  assertEnum(handoff.workflow_preset, WORKFLOW_PRESETS, "HandoffPackage.workflow_preset");
  if (handoff.reward_disclaimer !== null && handoff.reward_disclaimer !== undefined) {
    assertString(handoff.reward_disclaimer, "HandoffPackage.reward_disclaimer");
  }
  if (handoff.claim_workflow_version !== null && handoff.claim_workflow_version !== undefined) {
    assertString(handoff.claim_workflow_version, "HandoffPackage.claim_workflow_version");
  }
  assertArray(handoff.recommended_packages, "HandoffPackage.recommended_packages");
  handoff.recommended_packages.forEach((id, index) =>
    assertString(id, `HandoffPackage.recommended_packages[${index}]`),
  );
  assertArray(handoff.suggested_commands, "HandoffPackage.suggested_commands");
  handoff.suggested_commands.forEach((command, index) => {
    assertObject(command, `HandoffPackage.suggested_commands[${index}]`);
    if (command.kind !== "readonly_cli") {
      throw new Error(`HandoffPackage.suggested_commands[${index}].kind must be readonly_cli`);
    }
    assertString(command.command, `HandoffPackage.suggested_commands[${index}].command`);
    if (command.cwd !== null && command.cwd !== undefined) {
      assertString(command.cwd, `HandoffPackage.suggested_commands[${index}].cwd`);
    }
    assertString(command.reason, `HandoffPackage.suggested_commands[${index}].reason`);
  });
  assertArray(handoff.packages, "HandoffPackage.packages");
  handoff.packages.forEach((pkg, index) =>
    validateHandoffPackageEntry(pkg, `HandoffPackage.packages[${index}]`, handoff.schema_version),
  );
  return handoff;
}

function validateHandoffPackageEntry(pkg, name, schemaVersion = "1.1") {
  assertObject(pkg, name);
  assertString(pkg.candidate_id, `${name}.candidate_id`);
  assertEnum(pkg.verdict, VERDICTS, `${name}.verdict`);
  assertEnum(pkg.discovery_intent, DISCOVERY_INTENTS, `${name}.discovery_intent`);
  if (pkg.income_summary !== null && pkg.income_summary !== undefined) {
    assertString(pkg.income_summary, `${name}.income_summary`);
  }
  if (typeof pkg.has_observed_reward_metadata !== "boolean") {
    throw new Error(`${name}.has_observed_reward_metadata must be a boolean`);
  }
  assertString(pkg.repo_url, `${name}.repo_url`);
  assertString(pkg.issue_url, `${name}.issue_url`);
  assertArray(pkg.reward_signals, `${name}.reward_signals`);
  assertArray(pkg.evidence_ids, `${name}.evidence_ids`);
  pkg.evidence_ids.forEach((id, index) => assertString(id, `${name}.evidence_ids[${index}]`));
  assertArray(pkg.risks, `${name}.risks`);
  pkg.risks.forEach((risk, index) => assertString(risk, `${name}.risks[${index}]`));
  assertArray(pkg.denied_commands, `${name}.denied_commands`);
  assertArray(pkg.suggested_first_files, `${name}.suggested_first_files`);
  pkg.suggested_first_files.forEach((file, index) => assertString(file, `${name}.suggested_first_files[${index}]`));
  assertArray(pkg.allowed_actions, `${name}.allowed_actions`);
  pkg.allowed_actions.forEach((action, index) => assertString(action, `${name}.allowed_actions[${index}]`));
  assertArray(pkg.denied_actions, `${name}.denied_actions`);
  pkg.denied_actions.forEach((action, index) => assertString(action, `${name}.denied_actions[${index}]`));
  assertString(pkg.agent_notes, `${name}.agent_notes`);
  validateOptionalHandoffEntryFields(pkg, name, schemaVersion);
  return pkg;
}

function validateOptionalHandoffEntryFields(pkg, name, schemaVersion) {
  const optionalKeys = [
    "platform_claim_url",
    "platform_name",
    "payout_verified_externally",
    "acceptance_criteria_summary",
    "suggested_branch_name",
    "claim_steps",
    "roi_score",
    "estimated_effort_hours",
  ];

  for (const key of optionalKeys) {
    if (!Object.hasOwn(pkg, key)) continue;
    const value = pkg[key];
    switch (key) {
      case "platform_claim_url":
      case "acceptance_criteria_summary":
      case "suggested_branch_name":
        if (value !== null && value !== undefined) {
          assertString(value, `${name}.${key}`);
        }
        break;
      case "platform_name":
        if (value !== null && value !== undefined) {
          assertEnum(value, HANDOFF_PLATFORM_NAMES, `${name}.platform_name`);
        }
        break;
      case "payout_verified_externally":
        if (value !== undefined && value !== null && typeof value !== "boolean") {
          throw new Error(`${name}.payout_verified_externally must be a boolean`);
        }
        if (schemaVersion === "1.2" && value === true) {
          throw new Error(`${name}.payout_verified_externally must not be true from Scout export`);
        }
        break;
      case "claim_steps":
        assertArray(value, `${name}.claim_steps`);
        value.forEach((step, index) => assertString(step, `${name}.claim_steps[${index}]`));
        break;
      case "roi_score":
      case "estimated_effort_hours":
        if (value !== null && value !== undefined && typeof value !== "number") {
          throw new Error(`${name}.${key} must be a number or null`);
        }
        break;
      default:
        break;
    }
  }
}

const WORKFLOW_PRESET_VALUES = Object.freeze(["fast", "full"]);
const SESSION_ARTIFACT_KEYS = Object.freeze([
  "report_json",
  "report_md",
  "shortlist_md",
  "agent_summary_md",
  "handoff_json",
]);

export function validateSessionManifest(manifest) {
  assertObject(manifest, "SessionManifest");
  assertString(manifest.session_id, "SessionManifest.session_id");
  assertObject(manifest.profile, "SessionManifest.profile");
  if (manifest.workflow_preset_requested !== null && manifest.workflow_preset_requested !== undefined) {
    assertEnum(manifest.workflow_preset_requested, WORKFLOW_PRESET_VALUES, "SessionManifest.workflow_preset_requested");
  }
  if (manifest.workflow_preset_effective !== null && manifest.workflow_preset_effective !== undefined) {
    assertEnum(manifest.workflow_preset_effective, WORKFLOW_PRESET_VALUES, "SessionManifest.workflow_preset_effective");
  }
  if (typeof manifest.static_fetch_archives !== "boolean") {
    throw new Error("SessionManifest.static_fetch_archives must be a boolean");
  }
  assertArray(manifest.stages_completed, "SessionManifest.stages_completed");
  manifest.stages_completed.forEach((stage, index) => {
    assertEnum(stage, WORKFLOW_STAGES, `SessionManifest.stages_completed[${index}]`);
  });
  assertObject(manifest.artifacts, "SessionManifest.artifacts");
  for (const key of SESSION_ARTIFACT_KEYS) {
    assertString(manifest.artifacts[key], `SessionManifest.artifacts.${key}`);
  }
  assertString(manifest.generated_at, "SessionManifest.generated_at");
  return manifest;
}
