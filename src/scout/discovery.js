import { assertAllowed } from "./policy.js";
import {
  applyIssueMetadata,
  applyRepositoryMetadata,
  extractRewardSignals,
  linkedPrsFromTimeline,
} from "./candidate-metadata.js";
import {
  classifyQueries,
  normalizeQueryDescriptor,
  resolveDiscoveryBudgets,
  resolveMaxIssuesPerQuery,
  searchPerPageForQuery,
  selectDiscoveryItems,
  shouldInterleaveDiscoveryQueries,
} from "./discovery-query.js";
import { createGitHubClient } from "./github-client.js";
import { applyContributingPrefetch } from "./contributing-prefetch.js";
import { gitHubRateLimitFromHeaders } from "./github-rate-limit.js";

export { applyIssueMetadata, applyRepositoryMetadata, extractRewardSignals } from "./candidate-metadata.js";

export const DEFAULT_QUERIES = Object.freeze([
  'is:issue state:open label:"good first issue" no:assignee language:TypeScript',
  'is:issue state:open label:"good first issue" no:assignee language:Python',
  'is:issue state:open label:"help wanted" no:assignee language:TypeScript',
  'is:issue state:open label:"help wanted" no:assignee language:Python',
  'is:issue state:open label:"documentation" no:assignee',
  'is:issue state:open label:"bug" label:"good first issue" no:assignee',
]);

export function dedupeCandidates(candidates) {
  const seen = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.repo_owner}/${candidate.repo_name}#${candidate.issue_number}`;
    if (!seen.has(key)) {
      seen.set(key, candidate);
    }
  }
  return [...seen.values()];
}

export function fromGitHubSearchItem(item, discoveredByQuery, queryDescriptor = null) {
  const repoUrl = item.repository_url ?? "";
  const [repoOwner = "unknown", repoName = "unknown"] = repoUrl.split("/repos/")[1]?.split("/") ?? [];
  return {
    candidate_id: `SCOUT-${repoOwner}-${repoName}-${item.number}`.replace(/[^A-Za-z0-9-]/g, "-"),
    repo_owner: repoOwner,
    repo_name: repoName,
    repo_url: `https://github.com/${repoOwner}/${repoName}`,
    issue_number: item.number,
    issue_title: item.title,
    issue_url: item.html_url,
    labels: (item.labels ?? []).map((label) => label.name ?? String(label)),
    issue_state: item.state ?? "unknown",
    assignees: item.assignees?.map((assignee) => assignee.login) ?? [],
    created_at: item.created_at ?? null,
    updated_at: item.updated_at ?? null,
    discovered_by_query: discoveredByQuery,
    archived: null,
    default_branch: null,
    primary_language: null,
    license_spdx: null,
    latest_repo_activity_at: null,
    latest_maintainer_activity_at: null,
    linked_prs: [],
    source_observations: sourceObservationsFromQuery(queryDescriptor),
    collection_status: "PARTIAL",
    static_inspection_status: "not_requested",
  };
}

export async function discoverCandidates({
  policy,
  queries = DEFAULT_QUERIES,
  limit = 50,
  fetchImpl = globalThis.fetch,
  auditLog = null,
  collectionErrors = [],
  profile = null,
  enrich = true,
  cacheEnabled = fetchImpl === globalThis.fetch,
  enrichMode = null,
  githubClient = null,
  skipKnownKeys = null,
  since = null,
  knownCandidates = null,
}) {
  recordAllowed(policy, "github_search_read", auditLog);
  const client =
    githubClient ??
    createGitHubClient({
      fetchImpl,
      cacheEnabled,
      enrichMode,
      auditLog,
      policy,
      searchPaceMs: profile?.search_pace_ms ?? null,
      searchMaxRetries: profile?.search_max_retries ?? null,
      searchSecondaryCooldownMs: profile?.search_secondary_cooldown_ms ?? null,
    });

  const candidates = [];
  const maxPerQuery = resolveMaxIssuesPerQuery(profile);
  const interleave = shouldInterleaveDiscoveryQueries(profile);
  const { seed, broad } = classifyQueries(queries);
  const { seedLimit, partitioned } = resolveDiscoveryBudgets(profile, limit);

  if (partitioned) {
    await collectDiscoveryItems({
      queryEntries: seed,
      budget: seedLimit,
      candidates,
      client,
      policy,
      auditLog,
      collectionErrors,
      maxPerQuery,
      interleave,
    });
    await collectDiscoveryItems({
      queryEntries: broad,
      budget: limit - candidates.length,
      candidates,
      client,
      policy,
      auditLog,
      collectionErrors,
      maxPerQuery,
      interleave,
    });
  } else {
    await collectDiscoveryItems({
      queryEntries: queries,
      budget: limit,
      candidates,
      client,
      policy,
      auditLog,
      collectionErrors,
      maxPerQuery,
      interleave,
    });
  }

  let deduped = applyProfileFilters(dedupeCandidates(candidates), profile).slice(0, limit);
  deduped = applyIncrementalFilters(deduped, { skipKnownKeys, since });

  if (!enrich) {
    return deduped;
  }

  const { fresh, reused } = splitKnownCandidates(deduped, knownCandidates);
  const contributingCache = new Map();
  const prefetchContributing = profile?.prefetch_contributing === true;

  const enrichOne = async (candidate) => {
    let enriched = await enrichCandidateMetadata({
      policy,
      candidate,
      auditLog,
      client,
    });
    if (!prefetchContributing) {
      return enriched;
    }
    const merged = await applyContributingPrefetch({
      candidate: enriched,
      rewardFields: {
        reward_signals: enriched.reward_signals ?? [],
        has_verified_reward_signal: enriched.has_verified_reward_signal ?? false,
        has_observed_reward_metadata: enriched.has_observed_reward_metadata ?? false,
        has_inferred_reward_signal: enriched.has_inferred_reward_signal ?? false,
        estimated_reward_usd: enriched.estimated_reward_usd ?? null,
        estimated_reward_amount: enriched.estimated_reward_amount ?? null,
        reward_currency: enriched.reward_currency ?? null,
        source_observations: [],
      },
      client,
      cache: contributingCache,
      policy,
      auditLog,
    });
    return {
      ...enriched,
      ...merged,
      source_observations: [...(enriched.source_observations ?? []), ...(merged.source_observations ?? [])],
    };
  };

  const enrichedFresh = await client.enrichCandidates(fresh, enrichOne);
  return [...enrichedFresh, ...reused];
}

function splitKnownCandidates(candidates, knownCandidates) {
  if (!knownCandidates || knownCandidates.size === 0) {
    return { fresh: candidates, reused: [] };
  }
  const fresh = [];
  const reused = [];
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    const known = knownCandidates.get(key);
    if (known && known.updated_at === candidate.updated_at) {
      reused.push(known);
    } else {
      fresh.push(candidate);
    }
  }
  return { fresh, reused };
}

function applyIncrementalFilters(candidates, { skipKnownKeys, since }) {
  let filtered = candidates;
  if (since) {
    const sinceMs = new Date(since).getTime();
    filtered = filtered.filter((candidate) => {
      const updated = new Date(candidate.updated_at ?? 0).getTime();
      return !Number.isNaN(sinceMs) && updated > sinceMs;
    });
  }
  if (skipKnownKeys && skipKnownKeys.size > 0) {
    filtered = filtered.filter((candidate) => !skipKnownKeys.has(candidateKey(candidate)));
  }
  return filtered;
}

export function candidateKey(candidate) {
  return `${candidate.repo_owner}/${candidate.repo_name}#${candidate.issue_number}`;
}

async function collectDiscoveryItems({
  queryEntries,
  budget,
  candidates,
  client,
  policy,
  auditLog,
  collectionErrors,
  maxPerQuery,
  interleave,
}) {
  if (budget <= 0 || queryEntries.length === 0) {
    return;
  }

  const queryPages = [];
  for (const queryEntry of queryEntries) {
    const queryDescriptor = normalizeQueryDescriptor(queryEntry);
    const query = queryDescriptor.query;
    try {
      const searchResponse = await client.searchIssues(
        query,
        searchPerPageForQuery({ limit: budget, maxPerQuery }),
      );
      recordRateLimitObservation(auditLog, policy, "github_search_read", searchResponse.rate_limit, query);
      queryPages.push({
        descriptor: queryDescriptor,
        query,
        items: searchResponse.body?.items ?? [],
      });
    } catch (error) {
      const message = `GitHub search failed with status ${error.status ?? "unknown"}.`;
      recordCollectionError(collectionErrors, "github_search_read", message, query, error.rate_limit ?? null, {
        error_kind: error.error_kind ?? "search_failed",
        retry_count: error.retry_count ?? 0,
      });
      recordFailure(policy, "github_search_read", auditLog, message);
    }
  }

  const selected = selectDiscoveryItems(queryPages, {
    limit: budget,
    maxPerQuery,
    interleave,
  });
  for (const { item, descriptor, query } of selected) {
    candidates.push(fromGitHubSearchItem(item, query, descriptor));
  }
}

function sourceObservationsFromQuery(queryDescriptor) {
  if (queryDescriptor?.kind !== "trusted_seed_list") {
    return [];
  }
  return [
    {
      kind: "trusted_seed_list",
      value: queryDescriptor.seed_list_id,
      repo: queryDescriptor.repo,
    },
  ];
}

export async function enrichCandidateMetadata({ policy, candidate, fetchImpl = globalThis.fetch, auditLog = null, client = null }) {
  const github = client ?? createGitHubClient({ fetchImpl, auditLog, policy });
  let enriched = candidate;
  const metadataErrors = [];
  const rateLimitObservations = [];

  try {
    recordAllowed(policy, "github_repo_metadata_read", auditLog, candidate.candidate_id);
    const repositoryResponse = await github.fetchJson(
      `https://api.github.com/repos/${candidate.repo_owner}/${candidate.repo_name}`,
    );
    recordRateLimitObservation(auditLog, policy, "github_repo_metadata_read", repositoryResponse.rate_limit, candidate.candidate_id);
    pushRateLimitObservation(rateLimitObservations, "github_repo_metadata_read", repositoryResponse.rate_limit);
    enriched = applyRepositoryMetadata(enriched, repositoryResponse.body);
  } catch (error) {
    if (error.code === "SCOUT_POLICY_DENIED") throw error;
    metadataErrors.push(`repo metadata: ${error.message}`);
    recordFailure(policy, "github_repo_metadata_read", auditLog, error.message, candidate.candidate_id);
  }

  try {
    recordAllowed(policy, "github_issue_metadata_read", auditLog, candidate.candidate_id);
    const issueResponse = await github.fetchJson(
      `https://api.github.com/repos/${candidate.repo_owner}/${candidate.repo_name}/issues/${candidate.issue_number}`,
    );
    const issue = issueResponse.body;
    recordRateLimitObservation(auditLog, policy, "github_issue_metadata_read", issueResponse.rate_limit, candidate.candidate_id);
    pushRateLimitObservation(rateLimitObservations, "github_issue_metadata_read", issueResponse.rate_limit);
    const comments = await fetchIssueComments({ issue, candidate, github });
    const timelineItems = await fetchIssueTimeline({ candidate, github });
    enriched = applyIssueMetadata(enriched, { ...issue, comments, linked_prs: linkedPrsFromTimeline(timelineItems) });
    const rewardFields = extractRewardSignals(enriched, issue.body ?? "");
    enriched = {
      ...enriched,
      ...rewardFields,
      source_observations: [...(enriched.source_observations ?? []), ...rewardFields.source_observations],
    };
  } catch (error) {
    if (error.code === "SCOUT_POLICY_DENIED") throw error;
    metadataErrors.push(`issue metadata: ${error.message}`);
    recordFailure(policy, "github_issue_metadata_read", auditLog, error.message, candidate.candidate_id);
  }

  if (metadataErrors.length > 0) {
    return {
      ...enriched,
      collection_status: enriched.collection_status === "OBSERVED" ? "PARTIAL" : enriched.collection_status,
      source_observations: [
        ...(enriched.source_observations ?? []),
        ...rateLimitObservations,
        {
          kind: "metadata_error",
          value: metadataErrors.join("; "),
        },
      ],
    };
  }

  return {
    ...enriched,
    source_observations: [...(enriched.source_observations ?? []), ...rateLimitObservations],
  };
}

function applyProfileFilters(candidates, profile) {
  if (!profile) return candidates;
  const excludedOrgs = new Set((profile.exclude_orgs ?? []).map((item) => item.toLowerCase()));
  const excludedRepos = new Set((profile.exclude_repos ?? []).map((item) => item.toLowerCase()));
  return candidates.filter((candidate) => {
    const owner = candidate.repo_owner.toLowerCase();
    const repo = `${candidate.repo_owner}/${candidate.repo_name}`.toLowerCase();
    return !excludedOrgs.has(owner) && !excludedRepos.has(repo) && !excludedRepos.has(candidate.repo_name.toLowerCase());
  });
}

async function fetchIssueComments({ issue, candidate, github }) {
  const commentsUrl =
    issue.comments_url ?? `https://api.github.com/repos/${candidate.repo_owner}/${candidate.repo_name}/issues/${candidate.issue_number}/comments`;
  try {
    const response = await github.fetchJson(commentsUrl);
    return response.body;
  } catch {
    return [];
  }
}

async function fetchIssueTimeline({ candidate, github }) {
  try {
    const response = await github.fetchJson(
      `https://api.github.com/repos/${candidate.repo_owner}/${candidate.repo_name}/issues/${candidate.issue_number}/timeline`,
      { headers: { Accept: "application/vnd.github.mockingbird-preview+json" } },
    );
    return response.body;
  } catch {
    return [];
  }
}

function recordAllowed(policy, operation, auditLog, candidateId = null) {
  const decision = assertAllowed(policy, operation);
  auditLog?.record({
    operation,
    mode: policy.mode,
    decision: decision.decision,
    reason: decision.reason,
    candidate_id: candidateId,
    approval_id: decision.approval_id,
  });
  return decision;
}

function recordFailure(policy, operation, auditLog, reason, candidateId = null) {
  auditLog?.record({
    operation,
    mode: policy.mode,
    decision: "failed",
    reason,
    candidate_id: candidateId,
  });
}

function recordCollectionError(collectionErrors, operation, message, query = null, rateLimit = null, details = {}) {
  collectionErrors.push({
    error_id: `collection-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    operation,
    query,
    rate_limit: rateLimit,
    message,
    error_kind: details.error_kind ?? null,
    retry_count: details.retry_count ?? null,
    observed_at: new Date().toISOString(),
  });
}

function pushRateLimitObservation(observations, operation, rateLimit) {
  if (!rateLimit) return;
  observations.push({
    kind: "github_rate_limit",
    value: `${operation}: ${rateLimit.remaining ?? "unknown"}/${rateLimit.limit ?? "unknown"} remaining`,
    operation,
    rate_limit: rateLimit,
  });
}

function recordRateLimitObservation(auditLog, policy, operation, rateLimit, candidateId = null) {
  if (!rateLimit) return;
  auditLog?.record({
    operation,
    mode: policy.mode,
    decision: "observed",
    reason: `GitHub rate limit ${rateLimit.remaining ?? "unknown"}/${rateLimit.limit ?? "unknown"} remaining for ${rateLimit.resource ?? "unknown"} resource.`,
    candidate_id: candidateId,
  });
}

// Re-export for tests that mock raw fetch error paths on search
export { gitHubRateLimitFromHeaders };
