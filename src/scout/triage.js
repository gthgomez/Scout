const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_THRESHOLDS = Object.freeze({
  green_min_score: 30,
  max_issue_age_days: 365,
  recent_repo_activity_days: 90,
  recent_maintainer_activity_days: 180,
  min_issue_title_length: 12,
  max_estimated_files_touched: 5,
});

export const THRESHOLD_KEYS = Object.freeze(Object.keys(DEFAULT_THRESHOLDS));

export function resolveThresholds(threshold_overrides = {}) {
  if (!threshold_overrides || typeof threshold_overrides !== "object" || Array.isArray(threshold_overrides)) {
    throw new Error("threshold_overrides must be an object");
  }

  const normalized = {};
  for (const [key, value] of Object.entries(threshold_overrides)) {
    if (!THRESHOLD_KEYS.includes(key)) {
      throw new Error(`threshold_overrides.${key} is not a supported threshold`);
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`threshold_overrides.${key} must be a finite number`);
    }
    if (value < 0) {
      throw new Error(`threshold_overrides.${key} must be non-negative`);
    }
    if (!Number.isInteger(value)) {
      throw new Error(`threshold_overrides.${key} must be an integer`);
    }
    normalized[key] = value;
  }

  return { ...DEFAULT_THRESHOLDS, ...normalized };
}

export function resolveTriageConfig(profile = {}) {
  const threshold_overrides = profile?.threshold_overrides ?? {};
  return {
    profile_id: profile?.profile_id ?? "unprofiled",
    threshold_overrides,
    effective_thresholds: resolveThresholds(threshold_overrides),
  };
}

function daysSince(dateLike, now = new Date()) {
  if (!dateLike) return Number.POSITIVE_INFINITY;
  const time = new Date(dateLike).getTime();
  if (Number.isNaN(time)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - time) / MS_PER_DAY);
}

export function scoreCandidate(candidate, options = {}) {
  const now = options.now ?? new Date();
  const thresholds = resolveThresholds(options.threshold_overrides ?? options.profile?.threshold_overrides ?? {});
  let score = 0;
  const reasons = [];

  if (candidate.issue_title?.length >= thresholds.min_issue_title_length) {
    score += 25;
    reasons.push("+25 issue clarity");
  }
  if (hasPositiveSetupDocs(candidate)) {
    score += 20;
    reasons.push("+20 setup docs quality");
  }
  if (daysSince(candidate.latest_repo_activity_at ?? candidate.updated_at, now) <= thresholds.recent_repo_activity_days) {
    score += 15;
    reasons.push("+15 repo activity");
  }
  if (daysSince(candidate.latest_maintainer_activity_at, now) <= thresholds.recent_maintainer_activity_days) {
    score += 15;
    reasons.push("+15 maintainer responsiveness");
  }
  if (candidate.source_observations?.some((item) => item.kind === "tests_present")) {
    score += 10;
    reasons.push("+10 tests present");
  }
  if (["Python", "TypeScript", "JavaScript"].includes(candidate.primary_language)) {
    score += 10;
    reasons.push("+10 stack fit");
  }
  if (candidate.estimated_files_touched && candidate.estimated_files_touched <= thresholds.max_estimated_files_touched) {
    score += 5;
    reasons.push("+5 small file-touch estimate");
  }
  if (daysSince(candidate.updated_at, now) > thresholds.max_issue_age_days) {
    score -= 20;
    reasons.push("-20 stale issue");
  }
  if (!hasPositiveSetupDocs(candidate)) {
    score -= 25;
    reasons.push("-25 unclear setup");
  }
  if (candidate.requires_private_credentials) {
    score -= 30;
    reasons.push("-30 private credentials required");
  }
  if (candidate.claimed_in_comments) {
    score -= 40;
    reasons.push("-40 claimed issue");
  }
  if (candidate.linked_prs?.some((pr) => pr.likely_solves_issue)) {
    score -= 50;
    reasons.push("-50 linked PR likely solves it");
  }
  if (candidate.archived || candidate.issue_state === "closed" || candidate.assignees?.length > 0) {
    score -= 100;
    reasons.push("-100 archived, closed, or assigned");
  }

  return { score, reasons };
}

export function portfolioValueScore(candidate) {
  let score = 0;
  const reasons = [];
  if (candidate.latest_maintainer_activity_at) {
    score += 15;
    reasons.push("+15 maintainer likely to review");
  }
  if (candidate.has_acceptance_criteria) {
    score += 10;
    reasons.push("+10 clear acceptance criteria");
  }
  if (candidate.source_observations?.some((item) => item.kind === "contributor_guide")) {
    score += 10;
    reasons.push("+10 contributor guide");
  }
  if (candidate.visible_review_trail_likely) {
    score += 10;
    reasons.push("+10 likely visible PR review trail");
  }
  if (candidate.demonstrates_practical_skill) {
    score += 10;
    reasons.push("+10 practical skill evidence");
  }
  if (candidate.too_trivial) {
    score -= 20;
    reasons.push("-20 too trivial");
  }
  if (!candidate.latest_repo_activity_at) {
    score -= 30;
    reasons.push("-30 project appears inactive");
  }
  if (candidate.hostile_contributor_experience) {
    score -= 30;
    reasons.push("-30 weak contributor experience");
  }
  return { portfolio_score: score, portfolio_reasons: reasons };
}

export function triageCandidate(candidate, options = {}) {
  const profile = options.profile ?? {
    profile_id: options.profile_id,
    threshold_overrides: options.threshold_overrides ?? {},
  };
  const triageConfig = resolveTriageConfig(profile);
  const hardDrop = hardDropReason(candidate);
  const score = scoreCandidate(candidate, { ...options, threshold_overrides: triageConfig.threshold_overrides });
  const portfolio = portfolioValueScore(candidate);

  if (hardDrop) {
    return {
      candidate_id: candidate.candidate_id,
      verdict: "RED",
      rank: null,
      score: score.score,
      portfolio_score: portfolio.portfolio_score,
      drop_reason: hardDrop,
      gap_codes: hardDrop.includes("private") ? ["SECURITY_GAP"] : [],
      risk_summary: hardDrop,
      setup_status: "not_executed",
      abandon_criteria: "Do not pursue this issue unless the blocking condition changes.",
      human_next_action: "Drop candidate.",
      score_reasons: score.reasons,
      portfolio_reasons: portfolio.portfolio_reasons,
      threshold_policy: triageConfig,
    };
  }

  const stale = daysSince(candidate.updated_at, options.now ?? new Date()) > triageConfig.effective_thresholds.max_issue_age_days;
  const partial = candidate.collection_status !== "OBSERVED";
  const setupDocumented = hasPositiveSetupDocs(candidate);
  const verdict = partial
    ? "GRAY"
    : stale || !setupDocumented || score.score < triageConfig.effective_thresholds.green_min_score
      ? "YELLOW"
      : "GREEN";
  return {
    candidate_id: candidate.candidate_id,
    verdict,
    rank: null,
    score: score.score,
    portfolio_score: portfolio.portfolio_score,
    drop_reason: null,
    gap_codes: partial ? ["SOURCE_GAP"] : setupDocumented ? [] : ["SOURCE_GAP"],
    risk_summary: partial
      ? "Insufficient evidence for confident recommendation."
      : setupDocumented
        ? "No hard drop detected."
        : "Setup guidance has not been confirmed.",
    setup_status: setupDocumented ? "static_docs_ok" : "unknown",
    abandon_criteria: "Abandon if the issue is claimed, solved by a linked PR, or requires private credentials.",
    human_next_action: verdict === "GREEN" ? "Review manually before claiming." : "Review evidence gaps before pursuing.",
    score_reasons: score.reasons,
    portfolio_reasons: portfolio.portfolio_reasons,
    threshold_policy: triageConfig,
  };
}

function hasPositiveSetupDocs(candidate) {
  return candidate.source_observations?.some((item) => {
    if (item.kind !== "setup_docs") return false;
    const value = String(item.value ?? "").toLowerCase();
    return !value.includes("no setup") && !value.includes("missing setup");
  });
}

export function hardDropReason(candidate) {
  if (candidate.archived) return "Repository is archived.";
  if (candidate.issue_state === "closed") return "Issue is closed.";
  if (candidate.assignees?.length > 0) return "Issue already has an assignee.";
  if (candidate.claimed_in_comments) return "Issue appears claimed in comments.";
  if (candidate.linked_prs?.some((pr) => pr.likely_solves_issue)) return "Linked PR likely solves the issue.";
  if (candidate.requires_private_credentials) return "Work appears to require private credentials or paid services.";
  if (candidate.no_setup_guidance) return "No setup guidance found.";
  return null;
}

export function triageCandidates(candidates, options = {}) {
  return candidates
    .map((candidate) => triageCandidate(candidate, options))
    .sort((a, b) => {
      const verdictOrder = { GREEN: 0, YELLOW: 1, GRAY: 2, RED: 3 };
      return verdictOrder[a.verdict] - verdictOrder[b.verdict] || (b.score ?? 0) - (a.score ?? 0);
    })
    .map((decision, index) => ({ ...decision, rank: decision.verdict === "RED" ? null : index + 1 }));
}
