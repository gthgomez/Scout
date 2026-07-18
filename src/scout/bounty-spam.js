const SPAM_REPO_NAME_PATTERNS = Object.freeze([
  /bounty-forge/i,
  /prize-lab/i,
  /tentoftrials/i,
  /zeroeye/i,
  /hammer-and-nail-bounty/i,
  /kickama/i,
  /nailstorm/i,
  /frailbox-checkpoint/i,
  /manifest-wizard/i,
  /rustchain/i,
]);

const SPAM_TITLE_PATTERN = /^\[\$\d+(?:\.\d{2})?\s+bounty\]/i;
const BRACKET_BOUNTY_TITLE_PATTERN = /^\[BOUNTY/i;
const STAR_FOLLOW_BOUNTY_PATTERN = /\bstar\s*&\s*follow\b/i;
const RTC_FARM_TITLE_PATTERN = /\b\d+\s*RTC\b/i;

export function isFromTrustedSeedList(candidate) {
  return (candidate?.source_observations ?? []).some((observation) =>
    observation.kind === "trusted_seed_list" || observation.kind === "trusted_seed_body",
  );
}

function hasObservedPlatformUrl(candidate) {
  return (candidate?.reward_signals ?? []).some(
    (signal) => signal.kind === "platform_url" && signal.confidence === "OBSERVED",
  );
}

export function detectBountySpamSignals(candidate) {
  const signals = [];
  const repoFull = `${candidate?.repo_owner ?? ""}/${candidate?.repo_name ?? ""}`.toLowerCase();
  const repoName = String(candidate?.repo_name ?? "").toLowerCase();
  const title = String(candidate?.issue_title ?? "");
  const platformUrlObserved = hasObservedPlatformUrl(candidate);

  if (SPAM_TITLE_PATTERN.test(title) && !platformUrlObserved) {
    signals.push({
      kind: "title_template",
      confidence: "high",
      value: "bracketed dollar bounty title template",
    });
  }

  if (BRACKET_BOUNTY_TITLE_PATTERN.test(title)) {
    signals.push({
      kind: "bracket_bounty_title",
      confidence: "high",
      value: "bracketed [BOUNTY] title template",
    });
  }

  if (STAR_FOLLOW_BOUNTY_PATTERN.test(title)) {
    signals.push({
      kind: "engagement_farm_title",
      confidence: "high",
      value: "star and follow engagement farm title",
    });
  }

  if (RTC_FARM_TITLE_PATTERN.test(title) && /bounty|reward/i.test(title)) {
    signals.push({
      kind: "rtc_farm_title",
      confidence: "high",
      value: "RTC token bounty farm title",
    });
  }

  for (const pattern of SPAM_REPO_NAME_PATTERNS) {
    if (pattern.test(repoName) || pattern.test(repoFull)) {
      signals.push({
        kind: "repo_name",
        confidence: "high",
        value: pattern.source,
      });
      break;
    }
  }

  if (
    SPAM_TITLE_PATTERN.test(title) &&
    !platformUrlObserved &&
    !candidate?.latest_maintainer_activity_at &&
    !isFromTrustedSeedList(candidate)
  ) {
    signals.push({
      kind: "unresponsive_bounty_template",
      confidence: "high",
      value: "bounty title template without maintainer activity outside trusted programs",
    });
  }

  return dedupeSpamSignals(signals);
}

export function bountySpamHardDropReason(candidate) {
  if (isFromTrustedSeedList(candidate)) {
    return null;
  }

  const signals = detectBountySpamSignals(candidate);
  if (signals.some((signal) => signal.kind === "repo_name")) {
    return "Likely bounty spam (suspicious repo name pattern).";
  }
  if (
    signals.some(
      (signal) =>
        signal.confidence === "high" &&
        ["bracket_bounty_title", "engagement_farm_title", "rtc_farm_title"].includes(signal.kind),
    )
  ) {
    return "Likely bounty spam (high-confidence bounty farm title pattern).";
  }
  if (signals.filter((signal) => signal.confidence === "high").length >= 2) {
    return "Likely bounty spam (multiple high-confidence spam signals).";
  }
  return null;
}

export function bountySpamPenalty(candidate) {
  if (isFromTrustedSeedList(candidate)) {
    return { penalty: 0, reasons: [], signals: [] };
  }

  const signals = detectBountySpamSignals(candidate);
  let penalty = 0;
  const reasons = [];

  for (const signal of signals) {
    if (signal.kind === "title_template") {
      penalty += 40;
      reasons.push("-40 spam bounty title template");
    }
    if (signal.kind === "bracket_bounty_title") {
      penalty += 45;
      reasons.push("-45 bracketed [BOUNTY] title template");
    }
    if (signal.kind === "engagement_farm_title") {
      penalty += 50;
      reasons.push("-50 star-and-follow engagement farm title");
    }
    if (signal.kind === "rtc_farm_title") {
      penalty += 45;
      reasons.push("-45 RTC token bounty farm title");
    }
    if (signal.kind === "repo_name") {
      penalty += 50;
      reasons.push("-50 suspicious bounty farm repo name");
    }
    if (signal.kind === "unresponsive_bounty_template") {
      penalty += 25;
      reasons.push("-25 bounty template without maintainer activity");
    }
  }

  return { penalty, reasons, signals };
}

function dedupeSpamSignals(signals) {
  const seen = new Set();
  return signals.filter((signal) => {
    const key = `${signal.kind}:${signal.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
