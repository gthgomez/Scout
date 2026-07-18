import { mapPool, sleep } from "./async-pool.js";
import { createGitHubCache } from "./github-cache.js";
import { enrichCandidatesGraphql } from "./github-graphql.js";
import {
  classifySearchError,
  computeSearchRetryDelayMs,
  createSearchSessionGuard,
  isRetryableSearchError,
  parseRetryAfterSeconds,
  resolveSearchMaxRetries,
  resolveSearchPaceMs,
  resolveSearchSecondaryCooldownMs,
} from "./github-search-policy.js";
import { gitHubHeaders, gitHubRateLimitFromHeaders } from "./github-rate-limit.js";

const GRAPHQL_URL = "https://api.github.com/graphql";

function resolveEnrichMode(mode) {
  const raw = (mode ?? process.env.SCOUT_ENRICH_MODE ?? "auto").toLowerCase();
  if (["rest", "graphql", "auto"].includes(raw)) return raw;
  return "auto";
}

function shouldUseGraphql(mode, candidateCount) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  if (mode === "rest") return false;
  if (mode === "graphql") return Boolean(token);
  return Boolean(token) && candidateCount >= 5;
}

export function createGitHubClient({
  fetchImpl = globalThis.fetch,
  cacheDir = null,
  cacheEnabled = true,
  concurrency = Number(process.env.SCOUT_GITHUB_CONCURRENCY) || 4,
  enrichMode = null,
  auditLog = null,
  policy = null,
  searchPaceMs = null,
  searchMaxRetries = null,
  searchSecondaryCooldownMs = null,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for GitHub client");
  }

  const cache = createGitHubCache({ cacheDir, enabled: cacheEnabled });
  let lastRateLimit = null;
  const { paceSearch, onSecondaryLimitHit } = createSearchSessionGuard({
    paceMs: resolveSearchPaceMs(searchPaceMs),
    secondaryCooldownMs: resolveSearchSecondaryCooldownMs(searchSecondaryCooldownMs),
  });

  async function maybeBackoff(rateLimit) {
    if (!rateLimit || rateLimit.remaining === null || rateLimit.remaining >= 10) {
      return;
    }
    const resetMs = rateLimit.reset ? rateLimit.reset * 1000 : Date.now() + 1000;
    const waitMs = Math.max(0, resetMs - Date.now() + 1000);
    if (auditLog && policy) {
      auditLog.record({
        operation: "rate_limit_backoff",
        mode: policy.mode,
        decision: "observed",
        reason: `Backing off ${waitMs}ms until rate limit reset (remaining=${rateLimit.remaining}).`,
      });
    }
    await sleep(waitMs);
  }

  async function recordSearchBackoff(waitMs, error) {
    if (auditLog && policy) {
      auditLog.record({
        operation: "rate_limit_backoff",
        mode: policy.mode,
        decision: "observed",
        reason: `Search backoff ${waitMs}ms (${error.error_kind ?? classifySearchError(error)}, attempt=${error.retry_count ?? 0}).`,
      });
    }
    await sleep(waitMs);
  }

  async function request(url, { headers = {}, method = "GET", body = null, cacheCategory = "metadata", captureErrorBody = false } = {}) {
    const { key, entry } = await cache.getUrl(url, cacheCategory);
    if (entry?.body !== undefined && entry.status === 200) {
      lastRateLimit = entry.rate_limit ?? lastRateLimit;
      return {
        body: entry.body,
        rate_limit: entry.rate_limit,
        from_cache: true,
        status: 200,
      };
    }

    await maybeBackoff(lastRateLimit);

    const requestHeaders = gitHubHeaders(headers);
    if (entry?.etag) {
      requestHeaders["If-None-Match"] = entry.etag;
    }

    const response = await fetchImpl(url, {
      method,
      headers: requestHeaders,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const rateLimit = gitHubRateLimitFromHeaders(response.headers);
    lastRateLimit = rateLimit ?? lastRateLimit;

    if (response.status === 304 && entry) {
      return {
        body: entry.body,
        rate_limit: entry.rate_limit ?? rateLimit,
        from_cache: true,
        status: 200,
      };
    }

    if (!response.ok) {
      const errorBody = captureErrorBody && typeof response.text === "function" ? await response.text() : "";
      const error = new Error(`GitHub API request failed for ${url} with status ${response.status ?? "unknown"}`);
      error.rate_limit = rateLimit;
      error.status = response.status;
      if (captureErrorBody) {
        error.body = errorBody;
        error.retry_after = parseRetryAfterSeconds(response.headers);
      }
      throw error;
    }

    const responseBody = await response.json();
    const etag = response.headers?.get?.("etag") ?? null;
    await cache.set(key, {
      body: responseBody,
      etag,
      rate_limit: rateLimit,
      status: response.status,
      from_cache: false,
    });

    return {
      body: responseBody,
      rate_limit: rateLimit,
      from_cache: false,
      status: response.status,
    };
  }

  async function graphqlRequest(query, variables = {}) {
    const { key, entry } = await cache.getGraphql(query, variables);
    if (entry?.body !== undefined) {
      return { body: entry.body, rate_limit: entry.rate_limit, from_cache: true };
    }

    await maybeBackoff(lastRateLimit);

    const response = await fetchImpl(GRAPHQL_URL, {
      method: "POST",
      headers: gitHubHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ query, variables }),
    });

    const rateLimit = gitHubRateLimitFromHeaders(response.headers);
    lastRateLimit = rateLimit ?? lastRateLimit;

    if (!response.ok) {
      throw new Error(`GitHub GraphQL request failed with status ${response.status ?? "unknown"}`);
    }

    const body = await response.json();
    await cache.set(key, { body, rate_limit: rateLimit, status: response.status });
    return { body, rate_limit: rateLimit, from_cache: false };
  }

  async function searchIssues(query, perPage, page = 1) {
    const url = new URL("https://api.github.com/search/issues");
    url.searchParams.set("q", query);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    const urlString = url.toString();
    const maxRetries = resolveSearchMaxRetries(searchMaxRetries);
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      await paceSearch();
      try {
        return await request(urlString, { cacheCategory: "search", captureErrorBody: true });
      } catch (error) {
        error.retry_count = attempt;
        error.error_kind = classifySearchError(error);
        if (error.error_kind === "secondary_rate_limit") {
          onSecondaryLimitHit();
        }
        lastError = error;
        if (attempt >= maxRetries || !isRetryableSearchError(error)) {
          throw error;
        }
        const waitMs = computeSearchRetryDelayMs(attempt, error.retry_after);
        await recordSearchBackoff(waitMs, error);
      }
    }

    throw lastError ?? new Error("GitHub search failed after retries.");
  }

  async function fetchJson(url, options = {}) {
    return request(url, options);
  }

  async function enrichCandidates(candidates, enrichOne) {
    const mode = resolveEnrichMode(enrichMode);
    if (shouldUseGraphql(mode, candidates.length)) {
      try {
        return await enrichCandidatesGraphql(candidates, {
          graphqlRequest,
          enrichOne,
        });
      } catch {
        // fall through to REST
      }
    }
    return mapPool(candidates, concurrency, enrichOne);
  }

  return {
    cache,
    searchIssues,
    fetchJson,
    graphqlRequest,
    enrichCandidates,
    getLastRateLimit: () => lastRateLimit,
  };
}
