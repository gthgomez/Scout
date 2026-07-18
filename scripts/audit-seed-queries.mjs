/**
 * Audit trusted seed queries — hit counts per repo query variant.
 *
 * Usage: node scripts/audit-seed-queries.mjs [--profile rewarded-hunt]
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSearchProfile, queriesFromProfile } from "../src/scout/profiles.js";
import { loadTrustedSeedLists } from "../src/scout/seed-lists.js";
import { createGitHubClient } from "../src/scout/github-client.js";
import { defaultPolicy } from "../src/scout/policy.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadEnv() {
  try {
    const raw = await readFile(join(root, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch {
    // optional
  }
}

function parseProfileArg() {
  const idx = process.argv.indexOf("--profile");
  return idx === -1 ? "rewarded-hunt" : process.argv[idx + 1];
}

await loadEnv();

if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
  console.error("GITHUB_TOKEN or GH_TOKEN required for seed query audit.");
  process.exit(1);
}

const profileName = parseProfileArg();
const profile = createSearchProfile({ name: profileName });
const trustedSeedLists = await loadTrustedSeedLists(profile.trusted_seed_lists ?? []);
const queries = queriesFromProfile(profile, { trustedSeedLists });
const seedQueries = queries.filter((entry) => {
  const kind = typeof entry === "object" ? entry.kind : null;
  return kind === "trusted_seed_list" || kind === "trusted_seed_body";
});

const client = createGitHubClient({
  policy: defaultPolicy("metadata_only"),
  searchPaceMs: profile.search_pace_ms ?? 5000,
});

let hits = 0;
for (const entry of seedQueries) {
  const query = typeof entry === "string" ? entry : entry.query;
  const kind = typeof entry === "object" ? entry.kind : "seed";
  const repo = typeof entry === "object" ? entry.repo : "";
  try {
    const response = await client.searchIssues(query, 5, 1);
    const items = response.body?.items ?? [];
    if (items.length > 0) {
      hits += 1;
    }
    const sample = items[0];
    console.log(
      JSON.stringify({
        repo,
        kind,
        items_returned: items.length,
        sample_title: sample?.title ?? null,
        sample_labels: (sample?.labels ?? []).map((label) => label.name ?? label),
        query,
      }),
    );
  } catch (error) {
    console.log(JSON.stringify({ repo, kind, items_returned: 0, error: error.message, query }));
  }
}

console.log(JSON.stringify({ profile: profileName, seed_queries: seedQueries.length, seed_queries_with_hits: hits }));
