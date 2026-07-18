/**
 * Discovery query classification and collection helpers.
 */

export function normalizeQueryDescriptor(queryEntry) {
  if (typeof queryEntry === "string") {
    return { query: queryEntry };
  }
  if (!queryEntry || typeof queryEntry !== "object" || typeof queryEntry.query !== "string" || queryEntry.query.length === 0) {
    throw new Error("Discovery queries must be strings or query descriptor objects with a query string.");
  }
  return queryEntry;
}

const TRUSTED_SEED_QUERY_KINDS = Object.freeze(["trusted_seed_list", "trusted_seed_body"]);

function isTrustedSeedQueryDescriptor(queryEntry) {
  const descriptor = normalizeQueryDescriptor(queryEntry);
  return TRUSTED_SEED_QUERY_KINDS.includes(descriptor?.kind);
}

function candidateHasTrustedSeedObservation(candidate) {
  return (candidate?.source_observations ?? []).some((observation) =>
    TRUSTED_SEED_QUERY_KINDS.includes(observation.kind),
  );
}

function discoveredByTrustedSeedQuery(candidate) {
  const query = String(candidate?.discovered_by_query ?? "");
  return /^repo:[^/\s]+\/[^\s]+/.test(query);
}

/**
 * Returns true when the candidate was not discovered via a trusted seed-list query.
 */
export function isBroadDiscoveryCandidate(candidate) {
  if (candidateHasTrustedSeedObservation(candidate)) {
    return false;
  }
  if (discoveredByTrustedSeedQuery(candidate)) {
    return false;
  }
  return true;
}

/**
 * Split profile discovery queries into seed-list descriptors vs broad include queries.
 */
export function classifyQueries(queries = []) {
  const seed = [];
  const broad = [];
  for (const query of queries) {
    if (isTrustedSeedQueryDescriptor(query)) {
      seed.push(query);
    } else {
      broad.push(query);
    }
  }
  return { seed, broad };
}

export function resolveMaxIssuesPerQuery(profile) {
  const value = profile?.max_issues_per_query;
  return typeof value === "number" && value > 0 ? value : null;
}

export function shouldInterleaveDiscoveryQueries(profile) {
  return Boolean(profile?.interleave_discovery_queries);
}

/**
 * Partition the discovery limit between seed and broad query groups.
 */
export function resolveDiscoveryBudgets(profile, limit) {
  const reserveBroad = profile?.reserve_broad_query_slots ?? 0;
  const minSeedSlots = profile?.min_seed_candidate_slots ?? 0;
  if (reserveBroad > 0 || minSeedSlots > 0) {
    const broadLimit = Math.min(reserveBroad > 0 ? reserveBroad : limit, Math.max(0, limit - minSeedSlots));
    const seedLimit = Math.min(limit, Math.max(minSeedSlots, limit - broadLimit));
    return { seedLimit, broadLimit: Math.max(0, limit - seedLimit), partitioned: true };
  }
  return { seedLimit: limit, broadLimit: limit, partitioned: false };
}

export function resolveMaxIssuesPerBroadQuery(profile) {
  const value = profile?.max_issues_per_broad_query;
  return typeof value === "number" && value > 0 ? value : null;
}

export function isPlatformBroadQuery(query) {
  const normalized = String(query ?? "").toLowerCase();
  return (
    normalized.includes("label:algora") ||
    normalized.includes("label:issuehunt") ||
    normalized.includes("algora.io") ||
    normalized.includes("opire.dev") ||
    normalized.includes("in:title")
  );
}

export function resolveMaxIssuesPerSeedQuery(profile) {
  const value = profile?.max_issues_per_seed_query;
  return typeof value === "number" && value > 0 ? value : resolveMaxIssuesPerQuery(profile);
}

export function resolveMaxIssuesPerPlatformQuery(profile) {
  const value = profile?.max_issues_per_platform_query;
  if (typeof value === "number" && value > 0) {
    return value;
  }
  return resolveMaxIssuesPerBroadQuery(profile) ?? resolveMaxIssuesPerQuery(profile);
}

export function resolveSeedSearchMaxPages(profile) {
  const value = profile?.seed_search_max_pages;
  if (typeof value === "number" && value > 0) {
    return Math.min(value, 3);
  }
  return 1;
}

export function resolveMaxPerQueryForEntry(profile, queryEntry) {
  const descriptor = normalizeQueryDescriptor(queryEntry);
  if (TRUSTED_SEED_QUERY_KINDS.includes(descriptor.kind)) {
    return resolveMaxIssuesPerSeedQuery(profile);
  }
  if (isPlatformBroadQuery(descriptor.query)) {
    return resolveMaxIssuesPerPlatformQuery(profile);
  }
  return resolveMaxIssuesPerBroadQuery(profile) ?? resolveMaxIssuesPerQuery(profile);
}

export function resolveMinBroadQuerySearches(profile, broadQueryCount) {
  const reserve = profile?.reserve_broad_query_slots;
  if (typeof reserve !== "number" || reserve <= 0 || broadQueryCount <= 0) {
    return 0;
  }
  return Math.min(3, broadQueryCount);
}

/**
 * Round-robin seed and broad query descriptors so broad searches start early
 * instead of waiting for every seed repo search to finish.
 */
export function buildInterleavedSearchOrder(seedEntries = [], broadEntries = []) {
  const order = [];
  const maxLen = Math.max(seedEntries.length, broadEntries.length);
  for (let index = 0; index < maxLen; index += 1) {
    if (index < seedEntries.length) {
      order.push({ entry: seedEntries[index], group: "seed" });
    }
    if (index < broadEntries.length) {
      order.push({ entry: broadEntries[index], group: "broad" });
    }
  }
  return order;
}

function capItems(items, maxPerQuery) {
  if (maxPerQuery == null) {
    return items;
  }
  return items.slice(0, maxPerQuery);
}

function pageMaxPerQuery(page, fallback) {
  return page.maxPerQuery ?? fallback;
}

function selectSequential(queryPages, limit, maxPerQuery) {
  const selected = [];
  for (const page of queryPages) {
    if (selected.length >= limit) {
      break;
    }
    const items = capItems(page.items, pageMaxPerQuery(page, maxPerQuery));
    for (const item of items) {
      if (selected.length >= limit) {
        break;
      }
      selected.push({ item, descriptor: page.descriptor, query: page.query });
    }
  }
  return selected;
}

function selectInterleaved(queryPages, limit, maxPerQuery) {
  const cappedPages = queryPages.map((page) => ({
    ...page,
    items: capItems(page.items, pageMaxPerQuery(page, maxPerQuery)),
  }));
  const selected = [];
  let round = 0;
  while (selected.length < limit) {
    let added = false;
    for (const page of cappedPages) {
      if (selected.length >= limit) {
        break;
      }
      const item = page.items[round];
      if (item !== undefined) {
        selected.push({ item, descriptor: page.descriptor, query: page.query });
        added = true;
      }
    }
    if (!added) {
      break;
    }
    round += 1;
  }
  return selected;
}

/**
 * Select discovery items from per-query search pages.
 */
export function selectDiscoveryItems(queryPages, { limit, maxPerQuery = null, interleave = false }) {
  if (interleave) {
    return selectInterleaved(queryPages, limit, maxPerQuery);
  }
  return selectSequential(queryPages, limit, maxPerQuery);
}

export function searchPerPageForQuery({ limit, maxPerQuery }) {
  const cap = maxPerQuery ?? limit;
  return Math.min(50, cap);
}
