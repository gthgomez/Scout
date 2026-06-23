import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DISCOVERY_INTENTS } from "./types.js";
import { normalizeSeedRepo, queriesForSeedRepo as seedListQueriesForSeedRepo } from "./seed-lists.js";
import { validateSearchProfile } from "./validators.js";

export const PROFILE_PRESETS = Object.freeze({
  "beginner-python-ts": {
    discovery_intent: "beginner",
    languages: ["Python", "TypeScript"],
    labels: ["good first issue", "help wanted", "documentation"],
    trusted_seed_lists: ["beginner-small"],
    include_queries: ["is:issue state:open label:\"good first issue\" stars:<500 no:assignee"],
    repo_size_filter: "stars:<500",
  },
  "beginner-docs-only": {
    discovery_intent: "beginner",
    languages: ["Docs", "Python", "TypeScript"],
    labels: ["documentation", "docs", "help wanted"],
    trusted_seed_lists: ["docs-friendly"],
    include_queries: [],
  },
  "beginner-small-repos": {
    discovery_intent: "beginner",
    languages: ["TypeScript", "Python"],
    labels: ["good first issue", "help wanted"],
    trusted_seed_lists: ["beginner-small"],
    include_queries: ["is:issue state:open label:\"good first issue\" stars:<500 no:assignee"],
    repo_size_filter: "stars:<500",
  },
  "rewarded-typescript": {
    discovery_intent: "rewarded",
    languages: ["TypeScript"],
    labels: ["bounty", "reward", "sponsor"],
    trusted_seed_lists: ["rewarded-programs"],
    include_queries: [
      "is:issue state:open label:bounty no:assignee language:TypeScript",
      "is:issue state:open label:reward no:assignee language:TypeScript",
      'is:issue state:open "bounty" in:title no:assignee language:TypeScript',
      'is:issue state:open "paid" in:title no:assignee language:TypeScript',
      "is:issue state:open label:sponsor no:assignee language:TypeScript",
    ],
  },
  "rewarded-verified-only": {
    discovery_intent: "rewarded",
    languages: ["TypeScript"],
    labels: ["bounty", "reward"],
    trusted_seed_lists: ["rewarded-programs"],
    require_verified_reward: true,
    shortlist_verdicts: ["GREEN", "YELLOW"],
    include_queries: [
      "is:issue state:open label:bounty no:assignee language:TypeScript",
      "is:issue state:open label:reward no:assignee language:TypeScript",
    ],
  },
  "rewarded-trusted-only": {
    discovery_intent: "rewarded",
    languages: [],
    labels: [],
    seed_reward_labels: ["bounty", "reward", "algora", "paid", "sponsor", "issuehunt", "💰"],
    max_issues_per_query: 5,
    interleave_discovery_queries: true,
    reserve_broad_query_slots: 15,
    prefetch_contributing: true,
    trusted_seed_lists: ["rewarded-programs"],
    include_queries: [],
    require_verified_reward: true,
    require_trusted_seed: true,
    rank_shortlist_by_payout: true,
    queries_prioritize_seeds: true,
    shortlist_verdicts: ["GREEN", "YELLOW"],
  },
  "rewarded-hunt": {
    discovery_intent: "rewarded",
    languages: [],
    labels: [],
    seed_reward_labels: ["bounty", "reward", "algora", "paid", "sponsor", "issuehunt", "💰"],
    max_issues_per_query: 5,
    interleave_discovery_queries: true,
    reserve_broad_query_slots: 15,
    prefetch_contributing: true,
    search_pace_ms: 5000,
    trusted_seed_lists: ["rewarded-programs", "rewarded-programs-algora"],
    include_queries: [
      "is:issue state:open label:algora no:assignee stars:>500",
      "is:issue state:open label:bounty no:assignee stars:>1000",
      "is:issue state:open label:issuehunt no:assignee stars:>500",
      'is:issue state:open "algora.io" in:body no:assignee stars:>500',
    ],
    require_verified_reward: false,
    require_trusted_seed: false,
    rank_shortlist_by: "roi",
    queries_prioritize_seeds: true,
    broad_green_min_usd: 25,
    require_trusted_or_platform_for_broad_green: true,
    shortlist_verdicts: ["GREEN", "YELLOW"],
  },
});

export function isProfilePreset(name) {
  return Object.hasOwn(PROFILE_PRESETS, name);
}

export function presetDefaults(name) {
  return PROFILE_PRESETS[name] ?? {};
}

export function resolveDiscoveryIntent(profile) {
  return profile?.discovery_intent ?? "beginner";
}

export function createSearchProfile({
  name,
  languages,
  labels,
  include_queries,
  exclude_orgs = [],
  exclude_repos = [],
  trusted_seed_lists,
  max_candidates = 50,
  mode = "metadata_only",
  threshold_overrides = {},
  discovery_intent,
  require_verified_reward,
  require_trusted_seed,
  rank_shortlist_by_payout,
  rank_shortlist_by,
  preferred_languages,
  excluded_languages,
  min_repo_stars,
  max_repo_stars,
  queries_prioritize_seeds,
  seed_reward_labels,
  max_issues_per_query,
  interleave_discovery_queries,
  reserve_broad_query_slots,
  broad_green_min_usd,
  require_trusted_or_platform_for_broad_green,
  shortlist_verdicts,
  repo_size_filter,
  prefetch_contributing,
  search_pace_ms,
  search_max_retries,
  search_secondary_cooldown_ms,
}) {
  const preset = presetDefaults(name);
  const now = new Date().toISOString();
  const includeQueries = include_queries ?? preset.include_queries ?? [];
  const sizeFilter = repo_size_filter ?? preset.repo_size_filter;
  return validateSearchProfile({
    profile_id: `profile-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    name,
    discovery_intent: discovery_intent ?? preset.discovery_intent ?? "beginner",
    languages: languages ?? preset.languages ?? ["Python", "TypeScript"],
    labels: labels ?? preset.labels ?? ["good first issue", "help wanted", "documentation"],
    include_queries: sizeFilter && !includeQueries.some((q) => String(q).includes(sizeFilter))
      ? [...includeQueries, `is:issue state:open ${sizeFilter} no:assignee`]
      : includeQueries,
    exclude_orgs,
    exclude_repos,
    trusted_seed_lists: trusted_seed_lists ?? preset.trusted_seed_lists ?? [],
    max_candidates,
    mode,
    threshold_overrides,
    require_verified_reward: require_verified_reward ?? preset.require_verified_reward ?? false,
    require_trusted_seed: require_trusted_seed ?? preset.require_trusted_seed ?? false,
    rank_shortlist_by_payout: rank_shortlist_by_payout ?? preset.rank_shortlist_by_payout ?? false,
    rank_shortlist_by: rank_shortlist_by ?? preset.rank_shortlist_by ?? undefined,
    preferred_languages: preferred_languages ?? preset.preferred_languages ?? [],
    excluded_languages: excluded_languages ?? preset.excluded_languages ?? [],
    min_repo_stars: min_repo_stars ?? preset.min_repo_stars ?? null,
    max_repo_stars: max_repo_stars ?? preset.max_repo_stars ?? null,
    queries_prioritize_seeds: queries_prioritize_seeds ?? preset.queries_prioritize_seeds ?? false,
    seed_reward_labels: seed_reward_labels ?? preset.seed_reward_labels ?? [],
    max_issues_per_query: max_issues_per_query ?? preset.max_issues_per_query ?? null,
    interleave_discovery_queries: interleave_discovery_queries ?? preset.interleave_discovery_queries ?? false,
    reserve_broad_query_slots: reserve_broad_query_slots ?? preset.reserve_broad_query_slots ?? null,
    broad_green_min_usd: broad_green_min_usd ?? preset.broad_green_min_usd ?? null,
    require_trusted_or_platform_for_broad_green:
      require_trusted_or_platform_for_broad_green ?? preset.require_trusted_or_platform_for_broad_green ?? false,
    shortlist_verdicts: shortlist_verdicts ?? preset.shortlist_verdicts ?? ["GREEN", "YELLOW", "GRAY"],
    repo_size_filter: sizeFilter ?? null,
    prefetch_contributing: prefetch_contributing ?? preset.prefetch_contributing ?? false,
    search_pace_ms: search_pace_ms ?? preset.search_pace_ms ?? null,
    search_max_retries: search_max_retries ?? preset.search_max_retries ?? null,
    search_secondary_cooldown_ms: search_secondary_cooldown_ms ?? preset.search_secondary_cooldown_ms ?? null,
    created_at: now,
    updated_at: now,
  });
}

export function queriesFromProfile(profile, options = {}) {
  validateSearchProfile(profile);
  const generated = [];
  for (const label of profile.labels) {
    for (const language of profile.languages) {
      if (language === "Docs") {
        generated.push(appendRepoSizeFilter(`is:issue state:open label:"${label}" no:assignee`, profile));
      } else {
        generated.push(
          appendRepoSizeFilter(`is:issue state:open label:"${label}" no:assignee language:${language}`, profile),
        );
      }
    }
  }
  const includeQueries = profile.include_queries ?? [];
  const seedQueries = seedQueriesFromProfile(profile, options.trustedSeedLists ?? []);
  if (profile.queries_prioritize_seeds) {
    return dedupeQueries([...seedQueries, ...includeQueries, ...generated]);
  }
  return dedupeQueries([...includeQueries, ...seedQueries, ...generated]);
}

export function appendRepoSizeFilter(query, profile) {
  const filter = profile?.repo_size_filter;
  if (!filter || String(query).includes(filter)) {
    return query;
  }
  return `${query} ${filter}`;
}

function seedQueriesFromProfile(profile, trustedSeedLists) {
  const requestedSeedLists = new Set(profile.trusted_seed_lists ?? []);
  const seedQueries = [];
  for (const seedList of trustedSeedLists) {
    if (requestedSeedLists.size > 0 && !requestedSeedLists.has(seedList.seed_list_id)) continue;
    for (const repoEntry of seedList.repos ?? []) {
      const seedRepo = normalizeSeedRepo(repoEntry);
      for (const query of queriesForSeedRepo(seedRepo, profile)) {
        seedQueries.push({
          query,
          kind: "trusted_seed_list",
          seed_list_id: seedList.seed_list_id,
          seed_list_name: seedList.name,
          repo: seedRepo.repo,
        });
      }
    }
  }
  return seedQueries;
}

function queriesForSeedRepo(seedRepo, profile) {
  const overrideQueries = seedListQueriesForSeedRepo(seedRepo);
  if (overrideQueries) {
    return overrideQueries.map((query) => appendRepoSizeFilter(query, profile));
  }

  let labels = seedRepo.labels ?? profile.labels;
  if (labels.length === 0 && (profile.seed_reward_labels ?? []).length > 0) {
    labels = profile.seed_reward_labels;
  }
  const languages = seedRepo.languages ?? profile.languages;
  if (labels.length === 0) {
    return [appendRepoSizeFilter(`repo:${seedRepo.repo} is:issue state:open no:assignee`, profile)];
  }

  const labelClause = buildLabelOrClause(labels);
  const repoBase = `repo:${seedRepo.repo} is:issue state:open ${labelClause} no:assignee`;

  if (languages.length === 0) {
    return [appendRepoSizeFilter(repoBase, profile)];
  }

  const queries = [];
  for (const language of languages) {
    const query = language === "Docs" ? repoBase : `${repoBase} language:${language}`;
    queries.push(appendRepoSizeFilter(query, profile));
  }
  return queries;
}

function buildLabelOrClause(labels) {
  const parts = labels.map((label) => `label:"${escapeQueryValue(label)}"`);
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}

function dedupeQueries(queries) {
  const seen = new Set();
  const deduped = [];
  for (const query of queries) {
    const queryText = typeof query === "string" ? query : query.query;
    if (!seen.has(queryText)) {
      seen.add(queryText);
      deduped.push(query);
    }
  }
  return deduped;
}

function escapeQueryValue(value) {
  return String(value).replaceAll('"', '\\"');
}

export function profileAllowsOperation(profile, operation) {
  validateSearchProfile(profile);
  const forbidden = new Set(["git_clone", "package_install", "shell_command", "repo_script_execution", "github_push"]);
  return !forbidden.has(operation);
}

export function profileStoreDir(root = process.cwd()) {
  return join(root, ".scout", "profiles");
}

export function profileFileName(profileName) {
  const slug = String(profileName)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) {
    throw new Error("Profile name must contain at least one alphanumeric character.");
  }
  return `${slug}.json`;
}

export async function saveSearchProfile(profile, options = {}) {
  const validated = validateSearchProfile(profile);
  const dir = profileStoreDir(options.root);
  await mkdir(dir, { recursive: true });
  const path = join(dir, profileFileName(validated.name));
  await writeFile(path, JSON.stringify(validated, null, 2), "utf8");
  return { profile: validated, path };
}

export async function loadSearchProfile(name, options = {}) {
  const path = join(profileStoreDir(options.root), profileFileName(name));
  const raw = await readFile(path, "utf8");
  return validateSearchProfile(JSON.parse(raw));
}

export { DISCOVERY_INTENTS };
