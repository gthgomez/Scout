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
  if (candidate.claimed_in_comments) {
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

export function attachRoiFields(candidate, profile = {}, options = {}) {
  const estimated_effort_hours = computeEffortEstimate(candidate);
  const claim_friction_score = computeClaimFrictionScore(candidate, options);
  const stack_fit_score = computeStackFitScore(candidate, profile);
  const roi_score = computeRoiScore(candidate);

  candidate.estimated_effort_hours = estimated_effort_hours;
  candidate.claim_friction_score = claim_friction_score;
  candidate.stack_fit_score = stack_fit_score;
  candidate.roi_score = roi_score;
  return candidate;
}
