import { isBroadDiscoveryCandidate } from "./discovery-query.js";
import { isFromTrustedSeedList } from "./bounty-spam.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function clamp(min, max, value) {
  return Math.min(max, Math.max(min, value));
}

function daysSince(dateLike, now = new Date()) {
  if (!dateLike) return Number.POSITIVE_INFINITY;
  const time = new Date(dateLike).getTime();
  if (Number.isNaN(time)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - time) / MS_PER_DAY);
}

function bodyLength(candidate) {
  return String(candidate.issue_body ?? candidate.body ?? "").length;
}

function labelSet(candidate) {
  return new Set((candidate.labels ?? []).map((label) => String(label).toLowerCase()));
}

function hasPlatformUrl(candidate) {
  return (candidate.reward_signals ?? []).some((signal) => signal.kind === "platform_url");
}

export function computeEffortEstimate(candidate) {
  if (candidate.linked_prs?.some((pr) => pr.likely_solves_issue)) {
    return null;
  }

  let hours = 4;
  const length = bodyLength(candidate);
  if (length > 0 && length < 500) {
    hours -= 2;
  } else if (length > 3000) {
    hours += 4;
  }

  const labels = labelSet(candidate);
  if (labels.has("good first issue") || labels.has("documentation") || labels.has("docs")) {
    hours -= 3;
  }
  if (labels.has("epic") || labels.has("refactor")) {
    hours += 6;
  }

  const filesTouched = candidate.estimated_files_touched;
  if (typeof filesTouched === "number" && filesTouched > 3) {
    hours += (filesTouched - 3) * 2;
  }

  const commentCount = candidate.comment_count ?? candidate.comments_count;
  if (typeof commentCount === "number" && commentCount > 20) {
    hours += 2;
  }

  return clamp(1, 40, hours);
}

export function isStaleClaimOpportunity(candidate, options = {}) {
  const staleDays = options.staleClaimDays ?? 14;
  const now = options.now ?? new Date();
  const hasAssigneeOrAttempt =
    (candidate.assignees?.length ?? 0) > 0 ||
    candidate.has_attempt_comment ||
    candidate.claimed_in_comments;
  if (!hasAssigneeOrAttempt) {
    return false;
  }
  if (candidate.linked_prs?.some((pr) => pr.likely_solves_issue)) {
    return false;
  }
  if (candidate.has_open_linked_pr) {
    return false;
  }
  const lastActivity = candidate.last_comment_at ?? candidate.updated_at;
  return daysSince(lastActivity, now) >= staleDays;
}

export function computeClaimFrictionScore(candidate, options = {}) {
  const now = options.now ?? new Date();
  let score = 0;

  if (hasPlatformUrl(candidate)) {
    score += 25;
  }
  if (candidate.has_verified_reward_signal) {
    score += 20;
  }
  if (!candidate.assignees?.length) {
    score += 15;
  }
  if (daysSince(candidate.latest_maintainer_activity_at, now) < 30) {
    score += 15;
  }

  const commentCount = candidate.comment_count ?? candidate.comments_count;
  if (typeof commentCount === "number") {
    if (commentCount <= 3) {
      score += 10;
    } else if (commentCount > 15) {
      score -= 10;
    }
  }

  if (isStaleClaimOpportunity(candidate, options)) {
    score += 25;
  }
  if (candidate.has_open_linked_pr) {
    score -= 40;
  }
  if (candidate.claimed_in_comments && !isStaleClaimOpportunity(candidate, options)) {
    score -= 50;
  }
  if (candidate.linked_prs?.some((pr) => pr.likely_solves_issue)) {
    score -= 100;
  }
  if (!isFromTrustedSeedList(candidate) && isBroadDiscoveryCandidate(candidate)) {
    score -= 10;
  }

  return clamp(0, 100, score);
}

export function computeStackFitScore(candidate, profile = {}) {
  let score = 50;
  const language = candidate.primary_language;
  const preferred = profile.preferred_languages ?? [];
  const excluded = profile.excluded_languages ?? [];

  if (language && preferred.includes(language)) {
    score += 30;
  }
  if (language && excluded.includes(language)) {
    score -= 40;
  }

  const stars = candidate.repo_stars ?? candidate.stargazers_count;
  const minStars = profile.min_repo_stars;
  const maxStars = profile.max_repo_stars;
  if (typeof stars === "number") {
    const aboveMin = minStars === undefined || minStars === null || stars >= minStars;
    const belowMax = maxStars === undefined || maxStars === null || stars <= maxStars;
    if (aboveMin && belowMax) {
      score += 20;
    }
  }

  return clamp(0, 100, score);
}

export function computeRoiScore(candidate) {
  const effort = computeEffortEstimate(candidate);
  if (effort === null) {
    return null;
  }
  const reward = candidate.estimated_reward_usd;
  if (typeof reward !== "number" || !Number.isFinite(reward) || reward <= 0) {
    return null;
  }
  return reward / Math.max(effort, 1);
}

const INFERRED_ROI_CURRENCY_TIERS = Object.freeze({
  USD: 1,
  USDC: 0.85,
  USDT: 0.85,
  RTC: 0.05,
});

export function computeRoiScoreInferred(candidate) {
  const effort = computeEffortEstimate(candidate);
  if (effort === null) {
    return null;
  }
  const usdRoi = computeRoiScore(candidate);
  if (usdRoi !== null) {
    return { roi_score: usdRoi, roi_score_inferred: usdRoi, roi_confidence: "USD" };
  }
  const amount = candidate.estimated_reward_amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const currency = String(candidate.reward_currency ?? "UNKNOWN").toUpperCase();
  const tier = INFERRED_ROI_CURRENCY_TIERS[currency] ?? 0.25;
  const inferred = (amount * tier) / Math.max(effort, 1);
  return { roi_score: null, roi_score_inferred: inferred, roi_confidence: currency };
}

export function resolveRankingKey(candidate, rankShortlistBy = "score") {
  if (rankShortlistBy === "roi") {
    return candidate?.roi_score ?? candidate?.roi_score_inferred ?? 0;
  }
  if (rankShortlistBy === "payout") {
    return candidate?.estimated_reward_usd ?? 0;
  }
  return candidate?.triage_score ?? candidate?.score ?? 0;
}

export function formatDiscoverySource(candidate) {
  if (!candidate) {
    return "unknown";
  }
  if (isFromTrustedSeedList(candidate)) {
    return "trusted_seed";
  }
  if (hasPlatformUrl(candidate)) {
    return "platform";
  }
  if (isBroadDiscoveryCandidate(candidate)) {
    return "broad";
  }
  return "unknown";
}

export function attachRoiFields(candidate, profile = {}, options = {}) {
  const estimated_effort_hours = computeEffortEstimate(candidate);
  const claim_friction_score = computeClaimFrictionScore(candidate, options);
  const stack_fit_score = computeStackFitScore(candidate, profile);
  const roiFields = computeRoiScoreInferred(candidate) ?? {
    roi_score: null,
    roi_score_inferred: null,
    roi_confidence: null,
  };

  candidate.estimated_effort_hours = estimated_effort_hours;
  candidate.claim_friction_score = claim_friction_score;
  candidate.stack_fit_score = stack_fit_score;
  candidate.roi_score = roiFields.roi_score;
  candidate.roi_score_inferred = roiFields.roi_score_inferred;
  candidate.roi_confidence = roiFields.roi_confidence;
  candidate.discovery_source = formatDiscoverySource(candidate);
  candidate.is_stale_claim_opportunity = isStaleClaimOpportunity(candidate, options);
  return candidate;
}
