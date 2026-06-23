import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSearchProfile, presetDefaults, queriesFromProfile } from "../profiles.js";
import { loadTrustedSeedList } from "../seed-lists.js";

const SEED_REWARD_LABELS = ["bounty", "reward", "algora", "paid", "sponsor", "issuehunt", "💰"];
const CALCOM_REWARD_QUERY =
  'org:calcom is:issue state:open (label:"bounty" OR label:"reward" OR label:"algora" OR label:"paid" OR label:"sponsor" OR label:"issuehunt" OR label:"💰") no:assignee';

describe("rewarded-hunt preset", () => {
  it("matches the bounty discovery sprint spec", () => {
    const preset = presetDefaults("rewarded-hunt");
    assert.deepEqual(preset, {
      discovery_intent: "rewarded",
      languages: [],
      labels: [],
      seed_reward_labels: SEED_REWARD_LABELS,
      max_issues_per_query: 5,
      interleave_discovery_queries: true,
      reserve_broad_query_slots: 15,
      prefetch_contributing: true,
      trusted_seed_lists: ["rewarded-programs", "rewarded-programs-algora"],
      include_queries: [
        "is:issue state:open label:algora no:assignee stars:>500",
        "is:issue state:open label:bounty no:assignee stars:>1000",
        "is:issue state:open label:issuehunt no:assignee stars:>500",
        'is:issue state:open "algora.io" in:body no:assignee stars:>500',
      ],
      require_verified_reward: false,
      require_trusted_seed: false,
      rank_shortlist_by_payout: true,
      queries_prioritize_seeds: true,
      broad_green_min_usd: 25,
      require_trusted_or_platform_for_broad_green: true,
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

    const repoCount = rewardedPrograms.repos.length + rewardedProgramsAlgora.repos.length;
    const seedQueryCount = repoCount;
    const includeQueryCount = profile.include_queries.length;

    assert.equal(queries.length, seedQueryCount + includeQueryCount);
    assert.equal(queries.slice(0, seedQueryCount).every((query) => query.kind === "trusted_seed_list"), true);
    assert.deepEqual(
      queries.slice(seedQueryCount).map((query) => (typeof query === "string" ? query : query.query)),
      profile.include_queries,
    );
  });

  it("builds label-scoped seed queries when profile labels are empty", async () => {
    const profile = createSearchProfile({ name: "rewarded-hunt" });
    const rewardedPrograms = await loadTrustedSeedList("rewarded-programs");
    const queries = queriesFromProfile(profile, { trustedSeedLists: [rewardedPrograms] });
    const seedQueries = queries.filter((query) => query.kind === "trusted_seed_list");

    const calcomQueries = seedQueries.filter((query) => query.repo === "calcom/cal.com");
    assert.equal(calcomQueries.length, 1);
    assert.equal(calcomQueries[0].query, CALCOM_REWARD_QUERY);

    const labelScoped = seedQueries.filter((query) => query.repo !== "calcom/cal.com");
    assert.equal(labelScoped.length, rewardedPrograms.repos.length - 1);
    for (const query of labelScoped) {
      assert.match(
        query.query,
        /^repo:[^ ]+ is:issue state:open \(label:"[^"]+"( OR label:"[^"]+")+\) no:assignee$/,
      );
      assert.doesNotMatch(query.query, /language:/);
      assert.doesNotMatch(query.query, /^repo:[^ ]+ is:issue state:open no:assignee$/);
    }

    const bountyQueries = labelScoped.filter((query) => query.query.includes('label:"bounty"'));
    assert.equal(bountyQueries.length, rewardedPrograms.repos.length - 1);
  });
});
