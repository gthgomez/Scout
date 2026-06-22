import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DISCOVERY_INTENTS } from "./types.js";
import { normalizeSeedRepo } from "./seed-lists.js";
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
  shortlist_verdicts,
  repo_size_filter,
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
    shortlist_verdicts: shortlist_verdicts ?? preset.shortlist_verdicts ?? ["GREEN", "YELLOW", "GRAY"],
    repo_size_filter: sizeFilter ?? null,
    created_at: now,
    updated_at: now,
  });
}

export function queriesFromProfile(profile, options = {}) {
  validateSearchProfile(profile);
  const queries = [];
  for (const label of profile.labels) {
    for (const language of profile.languages) {
      if (language === "Docs") {
        queries.push(appendRepoSizeFilter(`is:issue state:open label:"${label}" no:assignee`, profile));
      } else {
        queries.push(
          appendRepoSizeFilter(`is:issue state:open label:"${label}" no:assignee language:${language}`, profile),
        );
      }
    }
  }
  return dedupeQueries([...profile.include_queries, ...seedQueriesFromProfile(profile, options.trustedSeedLists ?? []), ...queries]);
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
  const labels = seedRepo.labels ?? profile.labels;
  const languages = seedRepo.languages ?? profile.languages;
  if (labels.length === 0) {
    return [appendRepoSizeFilter(`repo:${seedRepo.repo} is:issue state:open no:assignee`, profile)];
  }

  const queries = [];
  for (const label of labels) {
    if (languages.length === 0) {
      queries.push(
        appendRepoSizeFilter(
          `repo:${seedRepo.repo} is:issue state:open label:"${escapeQueryValue(label)}" no:assignee`,
          profile,
        ),
      );
      continue;
    }
    for (const language of languages) {
      const base = `repo:${seedRepo.repo} is:issue state:open label:"${escapeQueryValue(label)}" no:assignee`;
      queries.push(appendRepoSizeFilter(language === "Docs" ? base : `${base} language:${language}`, profile));
    }
  }
  return queries;
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
