import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSearchProfile, presetDefaults, queriesFromProfile } from "../profiles.js";
import { loadTrustedSeedList } from "../seed-lists.js";

const SEED_REWARD_LABELS = ["bounty", "reward", "algora", "paid", "sponsor", "issuehunt", "💰"];
const CALCOM_REWARD_QUERY =
  'org:calcom is:issue state:open (label:"bounty" OR label:"reward" OR label:"algora" OR label:"paid" OR label:"sponsor" OR label:"issuehunt" OR label:"💰") no:assignee';
const SHARED_REWARDED_FIELDS = {
  discovery_intent: "rewarded",
  languages: [],
  labels: [],
  seed_reward_labels: SEED_REWARD_LABELS,
  seed_body_queries: true,
  require_unassigned: true,
  max_issues_per_query: 5,
  max_issues_per_seed_query: 5,
  max_issues_per_platform_query: 4,
  max_issues_per_broad_query: 1,
  seed_search_max_pages: 2,
  min_seed_candidate_slots: 5,
  interleave_discovery_queries: true,
  reserve_broad_query_slots: 15,
  prefetch_contributing: true,
  search_pace_ms: 5000,
  exclude_repos: ["Scottcjn/rustchain-bounties"],
  trusted_seed_lists: ["rewarded-programs", "rewarded-programs-algora"],
  include_queries: [
    "is:issue state:open label:algora no:assignee stars:>100",
    "is:issue state:open label:issuehunt no:assignee stars:>100",
    'is:issue state:open "algora.io" in:body no:assignee stars:>100',
    'is:issue state:open "issuehunt.io" in:body no:assignee stars:>100',
    'is:issue state:open "opire.dev" in:body no:assignee stars:>200',
    'is:issue state:open "bounty" in:title no:assignee stars:>500',
    "is:issue state:open label:bounty no:assignee stars:>1000",
  ],
  require_verified_reward: false,
  require_trusted_seed: false,
  rank_shortlist_by: "roi",
  queries_prioritize_seeds: true,
  broad_green_min_usd: 25,
  require_trusted_or_platform_for_broad_green: true,
};

describe("rewarded-hunt preset", () => {
  it("matches the bounty discovery sprint spec", () => {
    const preset = presetDefaults("rewarded-hunt");
    assert.deepEqual(preset, {
      ...SHARED_REWARDED_FIELDS,
      green_requires_platform_or_trusted: true,
      shortlist_verdicts: ["GREEN", "YELLOW"],
    });
  });

  it("orders seed queries before broad include_queries", async () => {
    const profile = createSearchProfile({ name: "rewarded-hunt" });
    const rewardedPrograms = await loadTrustedSeedList("rewarded-programs");
    const rewardedProgramsAlgora = await loadTrustedSeedList("rewarded-programs-algora");
    const queries = queriesFromProfile(profile, {
      trustedSeedLists: [rewardedPrograms, rewardedProgramsAlgora],
    });

    const seedQueries = queries.filter(
      (query) => query.kind === "trusted_seed_list" || query.kind === "trusted_seed_body",
    );
    const includeQueryCount = profile.include_queries.length;

    assert.equal(queries.length, seedQueries.length + includeQueryCount);
    assert.equal(
      queries.slice(0, seedQueries.length).every(
        (query) => query.kind === "trusted_seed_list" || query.kind === "trusted_seed_body",
      ),
      true,
    );
    assert.ok(seedQueries.some((query) => query.kind === "trusted_seed_body"));
    assert.deepEqual(
      queries.slice(seedQueries.length).map((query) => (typeof query === "string" ? query : query.query)),
      profile.include_queries,
    );
  });

  it("defaults rank_shortlist_by to roi on rewarded-hunt profile", () => {
    const profile = createSearchProfile({ name: "rewarded-hunt" });
    assert.equal(profile.rank_shortlist_by, "roi");
  });

  it("rewarded-cash-in preset requires GREEN-only trusted or platform shortlist", () => {
    const preset = presetDefaults("rewarded-cash-in");
    assert.equal(preset.shortlist_verdicts.join(","), "GREEN");
    assert.equal(preset.green_requires_platform_or_trusted, true);
    assert.equal(preset.rank_shortlist_by, "roi");
    assert.equal(preset.algora_platform_enrich, true);
    assert.equal(preset.seed_body_queries, false);
    assert.equal(preset.queries_prioritize_seeds, false);
    assert.equal(preset.seed_search_max_pages, 1);
    assert.ok(preset.include_queries[0].includes("algora"));
    assert.ok(preset.exclude_repos.includes("unkeydev/unkey"));
  });

  it("rewarded-cash-in stays within a lean query budget", async () => {
    const profile = createSearchProfile({ name: "rewarded-cash-in" });
    const rewardedPrograms = await loadTrustedSeedList("rewarded-programs");
    const rewardedProgramsAlgora = await loadTrustedSeedList("rewarded-programs-algora");
    const queries = queriesFromProfile(profile, {
      trustedSeedLists: [rewardedPrograms, rewardedProgramsAlgora],
    });
    // Platform-first include queries + one label query per seed (no dual body queries).
    assert.ok(queries.length <= 25, `expected ≤25 queries, got ${queries.length}`);
    assert.equal(queries[0], profile.include_queries[0]);
  });

  it("rewarded-explore preset surfaces YELLOW and relaxes platform/trusted GREEN gate", () => {
    const preset = presetDefaults("rewarded-explore");
    assert.equal(preset.green_requires_platform_or_trusted, false);
    assert.equal(preset.require_unassigned, false);
    assert.deepEqual(preset.shortlist_verdicts, ["GREEN", "YELLOW"]);
  });

  it("rewarded-hunt-dev preset caps candidates and broad queries for local iteration", () => {
    const preset = presetDefaults("rewarded-hunt-dev");
    assert.equal(preset.max_candidates, 15);
    assert.equal(preset.include_queries.length, 2);
    assert.equal(preset.algora_platform_enrich, false);
  });

  it("builds label-scoped and body seed queries when profile labels are empty", async () => {
    const profile = createSearchProfile({ name: "rewarded-hunt" });
    const rewardedPrograms = await loadTrustedSeedList("rewarded-programs");
    const queries = queriesFromProfile(profile, { trustedSeedLists: [rewardedPrograms] });
    const seedQueries = queries.filter(
      (query) => query.kind === "trusted_seed_list" || query.kind === "trusted_seed_body",
    );

    const calcomQueries = seedQueries.filter((query) => query.repo === "calcom/cal.com");
    assert.equal(calcomQueries.length, 1);
    assert.equal(calcomQueries[0].query, CALCOM_REWARD_QUERY);

    const labelScoped = seedQueries.filter(
      (query) => query.repo !== "calcom/cal.com" && query.kind === "trusted_seed_list",
    );
    assert.equal(labelScoped.length, rewardedPrograms.repos.length - 1);
    for (const query of labelScoped) {
      assert.match(
        query.query,
        /^repo:[^ ]+ is:issue state:open \(label:"[^"]+"( OR label:"[^"]+")+\) no:assignee$/,
      );
    }

    const bodyScoped = seedQueries.filter((query) => query.kind === "trusted_seed_body");
    assert.equal(bodyScoped.length, rewardedPrograms.repos.length - 1);
    for (const query of bodyScoped) {
      assert.match(query.query, /"algora\.io" in:body/);
      assert.match(query.query, /"issuehunt\.io" in:body/);
    }
  });
});
