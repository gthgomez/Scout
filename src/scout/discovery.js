import { assertAllowed } from "./policy.js";

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

export function applyRepositoryMetadata(candidate, repository) {
  return {
    ...candidate,
    archived: repository.archived ?? candidate.archived,
    default_branch: repository.default_branch ?? repository.defaultBranchRef?.name ?? candidate.default_branch,
    primary_language: repository.language ?? repository.primaryLanguage?.name ?? candidate.primary_language,
    license_spdx: repository.license?.spdx_id ?? repository.licenseInfo?.spdxId ?? candidate.license_spdx,
    latest_repo_activity_at:
      repository.pushed_at ?? repository.updated_at ?? repository.pushedAt ?? repository.updatedAt ?? candidate.latest_repo_activity_at,
    collection_status: candidate.collection_status === "FAILED" ? "PARTIAL" : "OBSERVED",
  };
}

export function applyIssueMetadata(candidate, issue) {
  const linkedPrs = issue.linked_prs ?? issue.timelineItems?.nodes?.filter((node) => node.pullRequest).map((node) => node.pullRequest) ?? [];
  const maintainerComment = latestMaintainerComment(issue.comments?.nodes ?? issue.comments ?? []);
  return {
    ...candidate,
    latest_maintainer_activity_at: maintainerComment?.updatedAt ?? maintainerComment?.updated_at ?? candidate.latest_maintainer_activity_at,
    linked_prs: linkedPrs.map(normalizeLinkedPr),
    claimed_in_comments: issueAppearsClaimed(issue.comments?.nodes ?? issue.comments ?? []),
    collection_status: candidate.collection_status === "FAILED" ? "PARTIAL" : "OBSERVED",
  };
}

function latestMaintainerComment(comments) {
  return comments
    .filter((comment) => ["OWNER", "MEMBER", "COLLABORATOR"].includes(authorAssociationOf(comment)))
    .sort((a, b) => new Date(b.updatedAt ?? b.updated_at ?? 0) - new Date(a.updatedAt ?? a.updated_at ?? 0))[0];
}

function authorAssociationOf(comment) {
  return comment.authorAssociation ?? comment.author_association;
}

function normalizeLinkedPr(pr) {
  const title = pr.title ?? "";
  const state = pr.state ?? "unknown";
  const merged = Boolean(pr.merged ?? pr.mergedAt);
  return {
    url: pr.url ?? pr.html_url ?? "",
    title,
    state,
    merged,
    likely_solves_issue: merged || /\b(fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved)\b/i.test(title),
  };
}

function issueAppearsClaimed(comments) {
  return comments.some((comment) => {
    const body = String(comment.body ?? "");
    return /\b(i'?ll take|i am working|i'm working|assigned to me|can i work|working on this)\b/i.test(body);
  });
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
}) {
  recordAllowed(policy, "github_search_read", auditLog);
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for discovery");
  }

  const candidates = [];
  for (const queryEntry of queries) {
    if (candidates.length >= limit) break;
    const queryDescriptor = normalizeQueryDescriptor(queryEntry);
    const query = queryDescriptor.query;
    const url = new URL("https://api.github.com/search/issues");
    url.searchParams.set("q", query);
    url.searchParams.set("per_page", String(Math.min(50, limit)));
    const response = await fetchImpl(url, { headers: gitHubHeaders() });
    const rateLimit = gitHubRateLimitFromHeaders(response.headers);
    recordRateLimitObservation(auditLog, policy, "github_search_read", rateLimit, query);
    if (!response.ok) {
      const message = `GitHub search failed with status ${response.status ?? "unknown"}.`;
      recordCollectionError(collectionErrors, "github_search_read", message, query, rateLimit);
      recordFailure(policy, "github_search_read", auditLog, message);
      continue;
    }
    const body = await response.json();
    for (const item of body.items ?? []) {
      candidates.push(fromGitHubSearchItem(item, query, queryDescriptor));
      if (candidates.length >= limit) break;
    }
  }
  const deduped = applyProfileFilters(dedupeCandidates(candidates), profile).slice(0, limit);
  if (!enrich) {
    return deduped;
  }
  const enriched = [];
  for (const candidate of deduped) {
    enriched.push(await enrichCandidateMetadata({ policy, candidate, fetchImpl, auditLog }));
  }
  return enriched;
}

function normalizeQueryDescriptor(queryEntry) {
  if (typeof queryEntry === "string") {
    return { query: queryEntry };
  }
  if (!queryEntry || typeof queryEntry !== "object" || typeof queryEntry.query !== "string" || queryEntry.query.length === 0) {
    throw new Error("Discovery queries must be strings or query descriptor objects with a query string.");
  }
  return queryEntry;
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

export async function enrichCandidateMetadata({ policy, candidate, fetchImpl = globalThis.fetch, auditLog = null }) {
  let enriched = candidate;
  const metadataErrors = [];
  const rateLimitObservations = [];

  try {
    recordAllowed(policy, "github_repo_metadata_read", auditLog, candidate.candidate_id);
    const repositoryResponse = await fetchGitHubJsonWithMetadata(
      `https://api.github.com/repos/${candidate.repo_owner}/${candidate.repo_name}`,
      fetchImpl,
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
    const issueResponse = await fetchGitHubJsonWithMetadata(
      `https://api.github.com/repos/${candidate.repo_owner}/${candidate.repo_name}/issues/${candidate.issue_number}`,
      fetchImpl,
    );
    const issue = issueResponse.body;
    recordRateLimitObservation(auditLog, policy, "github_issue_metadata_read", issueResponse.rate_limit, candidate.candidate_id);
    pushRateLimitObservation(rateLimitObservations, "github_issue_metadata_read", issueResponse.rate_limit);
    const comments = await fetchIssueComments({ issue, candidate, fetchImpl });
    const timelineItems = await fetchIssueTimeline({ candidate, fetchImpl });
    enriched = applyIssueMetadata(enriched, { ...issue, comments, linked_prs: linkedPrsFromTimeline(timelineItems) });
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

async function fetchGitHubJsonWithMetadata(url, fetchImpl, headers = {}) {
  const response = await fetchImpl(url, {
    headers: gitHubHeaders(headers),
  });
  if (!response.ok) {
    throw new Error(`GitHub API request failed for ${url} with status ${response.status ?? "unknown"}`);
  }
  return {
    body: await response.json(),
    rate_limit: gitHubRateLimitFromHeaders(response.headers),
  };
}

function gitHubHeaders(headers = {}) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  return {
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };
}

async function fetchGitHubJson(url, fetchImpl, headers = {}) {
  const response = await fetchGitHubJsonWithMetadata(url, fetchImpl, headers);
  return response.body;
}

async function fetchIssueComments({ issue, candidate, fetchImpl }) {
  const commentsUrl =
    issue.comments_url ?? `https://api.github.com/repos/${candidate.repo_owner}/${candidate.repo_name}/issues/${candidate.issue_number}/comments`;
  try {
    return await fetchGitHubJson(commentsUrl, fetchImpl);
  } catch {
    return [];
  }
}

async function fetchIssueTimeline({ candidate, fetchImpl }) {
  try {
    return await fetchGitHubJson(
      `https://api.github.com/repos/${candidate.repo_owner}/${candidate.repo_name}/issues/${candidate.issue_number}/timeline`,
      fetchImpl,
      { Accept: "application/vnd.github.mockingbird-preview+json" },
    );
  } catch {
    return [];
  }
}

function linkedPrsFromTimeline(timelineItems) {
  if (!Array.isArray(timelineItems)) return [];
  return timelineItems
    .map((item) => item.source?.issue ?? item)
    .filter((item) => item?.pull_request)
    .map((item) => ({
      title: item.title,
      state: item.state,
      url: item.html_url ?? item.pull_request?.html_url,
      merged: Boolean(item.pull_request?.merged_at),
    }));
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

function recordCollectionError(collectionErrors, operation, message, query = null, rateLimit = null) {
  collectionErrors.push({
    error_id: `collection-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    operation,
    query,
    rate_limit: rateLimit,
    message,
    observed_at: new Date().toISOString(),
  });
}

function gitHubRateLimitFromHeaders(headers) {
  const limit = readHeaderNumber(headers, "x-ratelimit-limit");
  const remaining = readHeaderNumber(headers, "x-ratelimit-remaining");
  const reset = readHeaderNumber(headers, "x-ratelimit-reset");
  const resource = readHeaderString(headers, "x-ratelimit-resource");
  const used = readHeaderNumber(headers, "x-ratelimit-used");
  if (limit === null && remaining === null && reset === null && resource === null && used === null) {
    return null;
  }
  return {
    limit,
    remaining,
    reset_at: reset === null ? null : new Date(reset * 1000).toISOString(),
    resource,
    used,
  };
}

function readHeaderNumber(headers, name) {
  const value = readHeaderString(headers, name);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readHeaderString(headers, name) {
  const value = headers?.get?.(name);
  if (value === undefined || value === null || value === "") return null;
  return String(value);
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
