const CLAIM_STEP_TEMPLATES = Object.freeze({
  algora: Object.freeze([
    "Open platform_claim_url and confirm bounty status is OPEN",
    "Read acceptance criteria in issue body",
    "Comment intent to work (manual; Scout does not post)",
    "Fork, branch, implement, open PR linking issue",
    "Submit claim on Algora console after PR opened",
  ]),
  issuehunt: Object.freeze([
    "Open platform_claim_url and confirm funding status on IssueHunt",
    "Read acceptance criteria in issue body",
    "Implement and open PR referencing issue",
    "Complete IssueHunt claim flow after merge",
  ]),
  opire: Object.freeze([
    "Open platform_claim_url and confirm bounty status on Opire",
    "Read acceptance criteria in issue body",
    "Comment intent to work (manual; Scout does not post)",
    "Fork, branch, implement, open PR linking issue",
    "Submit claim on Opire per program rules after PR is ready",
  ]),
  unknown: Object.freeze([
    "Search CONTRIBUTING.md or issue body for platform claim link",
    "Manually verify payout terms before investing effort",
    "Read acceptance criteria in issue body",
    "Fork, branch, implement, open PR referencing issue",
    "Follow platform-specific claim instructions after PR is ready",
  ]),
});

export const HANDOFF_PLATFORM_NAMES = Object.freeze(["algora", "issuehunt", "opire", "unknown"]);

export function normalizePlatformName(platform) {
  if (!platform) return "unknown";
  const normalized = String(platform).toLowerCase();
  return HANDOFF_PLATFORM_NAMES.includes(normalized) ? normalized : "unknown";
}

export function getClaimSteps(platformName) {
  const key = normalizePlatformName(platformName);
  return [...CLAIM_STEP_TEMPLATES[key]];
}

export function extractPlatformClaimInfo(rewardSignals = []) {
  const platformSignal = rewardSignals.find((signal) => signal.kind === "platform_url");
  if (!platformSignal) {
    return { platform_claim_url: null, platform_name: null };
  }
  return {
    platform_claim_url: platformSignal.value ?? null,
    platform_name: normalizePlatformName(platformSignal.platform),
  };
}

export function buildSuggestedBranchName(repoOwner, issueNumber) {
  if (!repoOwner || issueNumber === undefined || issueNumber === null) return null;
  const owner = String(repoOwner).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const number = Number(issueNumber);
  if (!owner || Number.isNaN(number)) return null;
  return `bounty/${owner}-${number}`;
}

export function buildAcceptanceCriteriaSummary(candidate) {
  if (!candidate?.has_acceptance_criteria) return null;
  const body = String(candidate.issue_body ?? candidate.body ?? "").trim();
  if (!body) return null;
  return body.length > 500 ? `${body.slice(0, 500)}…` : body;
}
