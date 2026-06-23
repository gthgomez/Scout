import { scanContributingRewardProgram } from "./contributing-reward-scan.js";
import { assertAllowed } from "./policy.js";
import { dedupeRewardSignals } from "./reward-signals.js";

export const CONTRIBUTING_PATHS = Object.freeze(["CONTRIBUTING.md", ".github/CONTRIBUTING.md"]);

function decodeGitHubContent(body) {
  if (!body || typeof body.content !== "string") {
    return null;
  }
  if (body.encoding === "base64") {
    return Buffer.from(body.content.replace(/\n/g, ""), "base64").toString("utf8");
  }
  return body.content;
}

export async function fetchContributingMarkdown(client, owner, repo, path = "CONTRIBUTING.md") {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const response = await client.fetchJson(url);
  return decodeGitHubContent(response.body);
}

export async function loadContributingRewardContext(client, owner, repo) {
  for (const path of CONTRIBUTING_PATHS) {
    try {
      const markdown = await fetchContributingMarkdown(client, owner, repo, path);
      if (markdown?.trim()) {
        return {
          path,
          markdown,
          observations: scanContributingRewardProgram(markdown, path),
        };
      }
    } catch {
      // try next path
    }
  }
  return null;
}

function platformSignalsFromContributingScan(observations, sourceRef) {
  const signals = [];
  for (const observation of observations ?? []) {
    if (observation.kind !== "reward_signal" || !String(observation.value).startsWith("platform_url:")) {
      continue;
    }
    const value = String(observation.value).slice("platform_url:".length);
    signals.push({
      kind: "platform_url",
      value,
      confidence: "OBSERVED",
      source_ref: sourceRef,
      platform: observation.platform ?? "unknown",
    });
  }
  return signals;
}

export function mergeContributingRewardFields(candidate, rewardFields, contributingContext) {
  if (!contributingContext?.observations?.length) {
    return rewardFields;
  }

  const sourceRef = contributingContext.path ?? "CONTRIBUTING.md";
  const platformSignals = platformSignalsFromContributingScan(contributingContext.observations, sourceRef);
  const programObservations = contributingContext.observations.filter((item) => item.kind === "contributing_reward_program");
  const mergedSignals = dedupeRewardSignals([...(rewardFields.reward_signals ?? []), ...platformSignals]);
  const hasVerified =
    mergedSignals.some(
      (signal) => signal.confidence === "OBSERVED" && ["label", "amount", "platform_url"].includes(signal.kind),
    ) || rewardFields.has_verified_reward_signal;
  const hasInferred =
    rewardFields.has_inferred_reward_signal ||
    programObservations.length > 0 ||
    mergedSignals.some((signal) => signal.confidence === "INFERRED" || signal.kind === "keyword");

  return {
    ...rewardFields,
    reward_signals: mergedSignals,
    has_verified_reward_signal: hasVerified,
    has_observed_reward_metadata: hasVerified,
    has_inferred_reward_signal: hasInferred,
    source_observations: [
      ...(rewardFields.source_observations ?? []),
      ...programObservations,
      ...platformSignals.map((signal) => ({
        kind: "reward_signal",
        value: `${signal.kind}:${signal.value}`,
        confidence: signal.confidence,
        source_ref: signal.source_ref,
      })),
    ],
  };
}

export async function applyContributingPrefetch({
  candidate,
  rewardFields,
  client,
  cache,
  policy,
  auditLog,
}) {
  const repoKey = `${candidate.repo_owner}/${candidate.repo_name}`;
  if (!cache.has(repoKey)) {
    recordAllowed(policy, "github_repo_metadata_read", auditLog, candidate.candidate_id);
    cache.set(repoKey, await loadContributingRewardContext(client, candidate.repo_owner, candidate.repo_name));
  }
  const context = cache.get(repoKey);
  return mergeContributingRewardFields(candidate, rewardFields, context);
}

function recordAllowed(policy, operation, auditLog, candidateId) {
  const decision = assertAllowed(policy, operation);
  auditLog?.record({
    operation,
    mode: policy.mode,
    decision: decision.decision,
    reason: decision.reason,
    candidate_id: candidateId,
    approval_id: decision.approval_id,
  });
}
