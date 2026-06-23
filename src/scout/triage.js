import { isBroadDiscoveryCandidate } from "./discovery-query.js";
import { resolveDiscoveryIntent } from "./profiles.js";
import { resolveRankShortlistBy } from "./validators.js";
import {
  bountySpamHardDropReason,
  bountySpamPenalty,
  isFromTrustedSeedList,
} from "./bounty-spam.js";
import { attachRoiFields } from "./roi-ranking.js";

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
    discovery_intent: resolveDiscoveryIntent(profile),
    threshold_overrides,
    effective_thresholds: resolveThresholds(threshold_overrides),
  };
}

export function resolveTriagePolicy(discovery_intent = "beginner") {
  if (discovery_intent === "rewarded") {
    return {
      discovery_intent: "rewarded",
      candidate_label: "Rewarded contribution candidate",
      require_reward_signal_for_green: true,
      deemphasize_too_trivial: true,
      green_min_score_override: 15,
    };
  }
  return {
    discovery_intent: "beginner",
    candidate_label: "Beginner contribution candidate",
    require_reward_signal_for_green: false,
    deemphasize_too_trivial: false,
    green_min_score_override: null,
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
  const discoveryIntent = options.discovery_intent ?? resolveDiscoveryIntent(options.profile);
  const triagePolicy = resolveTriagePolicy(discoveryIntent);
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

  if (discoveryIntent === "rewarded") {
    if (isFromTrustedSeedList(candidate)) {
      score += 20;
      reasons.push("+20 trusted reward program seed list");
    }
    if (candidate.has_verified_reward_signal) {
      score += 30;
      reasons.push("+30 verified reward signal");
    } else if (candidate.has_inferred_reward_signal) {
      score += 15;
      reasons.push("+15 inferred reward signal");
    }
    if (candidate.estimated_reward_usd) {
      score += 10;
      reasons.push("+10 payout amount mentioned");
    }
    if (candidate.has_acceptance_criteria) {
      score += 10;
      reasons.push("+10 acceptance criteria");
    }
    const spam = bountySpamPenalty(candidate);
    if (spam.penalty > 0) {
      score -= spam.penalty;
      reasons.push(...spam.reasons);
    }
  }

  if (daysSince(candidate.updated_at, now) > thresholds.max_issue_age_days) {
    score -= 20;
    reasons.push("-20 stale issue");
  }
  if (!hasPositiveSetupDocs(candidate) && discoveryIntent !== "rewarded") {
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
  if (candidate.too_trivial && !triagePolicy.deemphasize_too_trivial) {
    score -= 20;
    reasons.push("-20 too trivial");
  }

  return { score, reasons };
}

export function portfolioValueScore(candidate, options = {}) {
  const discoveryIntent = options.discovery_intent ?? resolveDiscoveryIntent(options.profile);
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
  if (candidate.too_trivial && discoveryIntent !== "rewarded") {
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
  if (discoveryIntent === "rewarded" && candidate.has_verified_reward_signal) {
    score += 15;
    reasons.push("+15 verified reward clarity");
  }
  return { portfolio_score: score, portfolio_reasons: reasons };
}

export function buildIncomeSummary(candidate) {
  if (!candidate.has_verified_reward_signal && !candidate.has_inferred_reward_signal) {
    return null;
  }
  const parts = [];
  if (candidate.has_verified_reward_signal) {
    const labelSignals = (candidate.reward_signals ?? []).filter((signal) => signal.confidence === "OBSERVED");
    if (labelSignals.length > 0) {
      parts.push(`Observed ${labelSignals.map((signal) => signal.value).join(", ")} signal`);
    }
  }
  if (candidate.estimated_reward_usd) {
    parts.push(`$${candidate.estimated_reward_usd} mentioned in issue text (inferred, not verified payout)`);
  } else if (candidate.has_inferred_reward_signal) {
    parts.push("Inferred reward keywords in issue metadata");
  }
  return parts.length > 0 ? `${parts.join("; ")}. Scout does not verify payout or platform terms.` : null;
}

export function triageCandidate(candidate, options = {}) {
  const now = options.now ?? new Date();
  const profile = options.profile ?? {
    profile_id: options.profile_id,
    threshold_overrides: options.threshold_overrides ?? {},
    discovery_intent: options.discovery_intent,
    require_trusted_seed: options.require_trusted_seed,
  };
  attachRoiFields(candidate, profile, { now });
  const triageConfig = resolveTriageConfig(profile);
  const triagePolicy = resolveTriagePolicy(triageConfig.discovery_intent);
  const hardDrop = hardDropReason(candidate, { profile });
  const score = scoreCandidate(candidate, { ...options, profile, discovery_intent: triageConfig.discovery_intent });
  const portfolio = portfolioValueScore(candidate, { ...options, profile, discovery_intent: triageConfig.discovery_intent });
  const incomeSummary = triageConfig.discovery_intent === "rewarded" ? buildIncomeSummary(candidate) : null;

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
      discovery_intent: triageConfig.discovery_intent,
      candidate_label: triagePolicy.candidate_label,
      income_summary: incomeSummary,
    };
  }

  const greenMinScore = triagePolicy.green_min_score_override ?? triageConfig.effective_thresholds.green_min_score;
  const stale = daysSince(candidate.updated_at, now) > triageConfig.effective_thresholds.max_issue_age_days;
  const partial = candidate.collection_status !== "OBSERVED";
  const setupDocumented = hasPositiveSetupDocs(candidate);
  const hasVerifiedReward = candidate.has_verified_reward_signal === true;
  const hasInferredReward = candidate.has_inferred_reward_signal === true;
  const hasRewardSignal = hasVerifiedReward || hasInferredReward;

  let verdict;
  let gapCodes;
  let riskSummary;
  let humanNextAction;

  if (partial) {
    verdict = "GRAY";
    gapCodes = ["SOURCE_GAP"];
    riskSummary = "Insufficient evidence for confident recommendation.";
    humanNextAction = "Review evidence gaps before pursuing.";
  } else if (triageConfig.discovery_intent === "rewarded" && !hasRewardSignal) {
    verdict = "GRAY";
    gapCodes = ["REWARD_GAP"];
    riskSummary = "No reward or bounty signal detected in GitHub metadata.";
    humanNextAction = "Review manually or broaden rewarded discovery queries before pursuing.";
  } else if (triageConfig.discovery_intent === "rewarded" && !hasVerifiedReward) {
    verdict = "YELLOW";
    gapCodes = ["REWARD_GAP"];
    riskSummary = "Only inferred reward signal; verified bounty label or title payout is required for GREEN.";
    humanNextAction = "Confirm payout terms manually before pursuing; inferred body keywords are not sufficient.";
  } else if (triageConfig.discovery_intent === "rewarded") {
    const broadGreenGate = evaluateBroadGreenGate(candidate, profile);
    if (!broadGreenGate.passes) {
      verdict = "YELLOW";
      gapCodes = ["REWARD_GAP"];
      riskSummary = broadGreenGate.risk_summary;
      humanNextAction = broadGreenGate.human_next_action;
    } else {
      verdict = stale || score.score < greenMinScore ? "YELLOW" : "GREEN";
      gapCodes = [];
      riskSummary = incomeSummary ?? "Verified reward signal detected; payout not verified by Scout.";
      humanNextAction =
        verdict === "GREEN"
          ? "Review reward terms manually before pursuing payout."
          : "Gather more reward clarity before pursuing.";
    }
  } else {
    verdict = stale || !setupDocumented || score.score < greenMinScore ? "YELLOW" : "GREEN";
    gapCodes = setupDocumented ? [] : ["SOURCE_GAP"];
    riskSummary = setupDocumented ? "No hard drop detected." : "Setup guidance has not been confirmed.";
    humanNextAction = verdict === "GREEN" ? "Review manually before claiming." : "Review evidence gaps before pursuing.";
  }

  return {
    candidate_id: candidate.candidate_id,
    verdict,
    rank: null,
    score: score.score,
    portfolio_score: portfolio.portfolio_score,
    drop_reason: null,
    gap_codes: gapCodes,
    risk_summary: riskSummary,
    setup_status: setupDocumented ? "static_docs_ok" : "unknown",
    abandon_criteria: "Abandon if the issue is claimed, solved by a linked PR, or requires private credentials.",
    human_next_action: humanNextAction,
    score_reasons: score.reasons,
    portfolio_reasons: portfolio.portfolio_reasons,
    threshold_policy: triageConfig,
    discovery_intent: triageConfig.discovery_intent,
    candidate_label: triagePolicy.candidate_label,
    income_summary: incomeSummary,
  };
}

function hasPositiveSetupDocs(candidate) {
  return candidate.source_observations?.some((item) => {
    if (item.kind !== "setup_docs") return false;
    const value = String(item.value ?? "").toLowerCase();
    return !value.includes("no setup") && !value.includes("missing setup");
  });
}

const DEFAULT_BROAD_GREEN_MIN_USD = 25;

function hasPlatformUrlRewardSignal(candidate) {
  return (candidate?.reward_signals ?? []).some((signal) => signal.kind === "platform_url");
}

function hasTitleVerifiedRewardSignal(candidate) {
  return (candidate?.reward_signals ?? []).some(
    (signal) =>
      signal.confidence === "OBSERVED" &&
      signal.source_ref === "issue_title" &&
      (signal.kind === "amount" || signal.kind === "keyword"),
  );
}

export function evaluateBroadGreenGate(candidate, profile = {}) {
  if (profile.require_trusted_or_platform_for_broad_green !== true) {
    return { passes: true, risk_summary: null, human_next_action: null };
  }
  if (isFromTrustedSeedList(candidate) || !isBroadDiscoveryCandidate(candidate)) {
    return { passes: true, risk_summary: null, human_next_action: null };
  }

  const minUsd = profile.broad_green_min_usd ?? DEFAULT_BROAD_GREEN_MIN_USD;
  const hasPlatformUrl = hasPlatformUrlRewardSignal(candidate);
  const hasMinUsd =
    typeof candidate.estimated_reward_usd === "number" &&
    Number.isFinite(candidate.estimated_reward_usd) &&
    candidate.estimated_reward_usd >= minUsd;
  const hasTitleVerified = hasTitleVerifiedRewardSignal(candidate);

  if (hasPlatformUrl || hasMinUsd || hasTitleVerified) {
    return { passes: true, risk_summary: null, human_next_action: null };
  }

  return {
    passes: false,
    risk_summary:
      "Broad-query reward candidate: label-only bounty on an unknown repo does not meet GREEN quality gate (requires platform URL, verified title payout, or minimum USD amount).",
    human_next_action:
      "Confirm payout platform and amount manually; GitHub bounty labels alone are insufficient for broad-discovered repos.",
  };
}

export function hardDropReason(candidate, options = {}) {
  const profile = options.profile ?? {};
  if (profile.require_trusted_seed && !isFromTrustedSeedList(candidate)) {
    return "Outside trusted reward program seed list.";
  }
  const spamDrop = bountySpamHardDropReason(candidate);
  if (spamDrop) return spamDrop;
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
  const profile = options.profile ?? {};
  const rankShortlistBy = resolveRankShortlistBy(profile);
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));

  return candidates
    .map((candidate) => triageCandidate(candidate, options))
    .sort((a, b) => compareTriageDecisions(a, b, { rankShortlistBy, candidateById }))
    .map((decision, index) => ({ ...decision, rank: decision.verdict === "RED" ? null : index + 1 }));
}

export function compareTriageDecisions(a, b, { rankShortlistBy = "score", candidateById }) {
  const verdictOrder = { GREEN: 0, YELLOW: 1, GRAY: 2, RED: 3 };
  const verdictCompare = verdictOrder[a.verdict] - verdictOrder[b.verdict];
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
}
