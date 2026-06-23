import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bountySpamHardDropReason,
  bountySpamPenalty,
  detectBountySpamSignals,
  isFromTrustedSeedList,
} from "../bounty-spam.js";
import { hardDropReason, triageCandidates } from "../triage.js";
import { createSearchProfile, queriesFromProfile } from "../profiles.js";
import { loadTrustedSeedList } from "../seed-lists.js";

const SEED_REWARD_LABELS = ["bounty", "reward", "algora", "paid", "sponsor", "issuehunt", "💰"];

describe("bounty spam detection", () => {
  it("flags bracketed bounty title templates", () => {
    const signals = detectBountySpamSignals({
      issue_title: "[$50 BOUNTY] [Rust] Add protocol frame codec recovery tests",
      repo_owner: "spam",
      repo_name: "demo",
    });
    assert.ok(signals.some((signal) => signal.kind === "title_template"));
  });

  it("flags known bounty farm repo names", () => {
    const signals = detectBountySpamSignals({
      issue_title: "Fix websocket reconnect",
      repo_owner: "user",
      repo_name: "zeroeye",
    });
    assert.ok(signals.some((signal) => signal.kind === "repo_name"));
    assert.equal(bountySpamHardDropReason({ repo_owner: "user", repo_name: "zeroeye", issue_title: "x" }), "Likely bounty spam (suspicious repo name pattern).");
  });

  it("does not hard-drop trusted seed-list candidates for spam repo heuristics", () => {
    const candidate = {
      repo_owner: "user",
      repo_name: "zeroeye",
      issue_title: "[$20 BOUNTY] task",
      source_observations: [{ kind: "trusted_seed_list", value: "rewarded-programs", repo: "user/zeroeye" }],
    };
    assert.equal(isFromTrustedSeedList(candidate), true);
    assert.equal(bountySpamHardDropReason(candidate), null);
    assert.equal(bountySpamPenalty(candidate).penalty, 0);
  });
});

describe("rewarded-trusted-only preset", () => {
  it("uses seed-first queries without broad bounty searches", async () => {
    const profile = createSearchProfile({ name: "rewarded-trusted-only" });
    const seedList = await loadTrustedSeedList("rewarded-programs");
    const queries = queriesFromProfile(profile, { trustedSeedLists: [seedList] });

    assert.equal(profile.require_trusted_seed, true);
    assert.equal(profile.rank_shortlist_by_payout, true);
    assert.equal(profile.queries_prioritize_seeds, true);
    assert.deepEqual(profile.include_queries, []);
    assert.deepEqual(profile.labels, []);
    assert.deepEqual(profile.seed_reward_labels, SEED_REWARD_LABELS);

    const calcomOverride = queries.find(
      (query) => query.kind === "trusted_seed_list" && query.repo === "calcom/cal.com",
    );
    assert.ok(calcomOverride);
    assert.equal(calcomOverride.query, 'org:calcom is:issue state:open (label:"bounty" OR label:"reward" OR label:"algora" OR label:"paid" OR label:"sponsor" OR label:"issuehunt" OR label:"💰") no:assignee');

    const labelScoped = queries.filter(
      (query) => query.kind === "trusted_seed_list" && query.repo !== "calcom/cal.com",
    );
    const otherRepos = seedList.repos.filter((entry) => entry.repo !== "calcom/cal.com");
    assert.equal(labelScoped.length, otherRepos.length);
    for (const query of labelScoped) {
      assert.match(
        query.query,
        /^repo:[^ ]+ is:issue state:open \(label:"[^"]+"( OR label:"[^"]+")+\) no:assignee$/,
      );
      assert.doesNotMatch(query.query, /^repo:[^ ]+ is:issue state:open no:assignee$/);
    }
  });

  it("hard-drops candidates outside trusted seed lists when required", () => {
    const drop = hardDropReason(
      {
        repo_owner: "spam",
        repo_name: "zeroeye",
        issue_title: "[$20 BOUNTY] task",
      },
      { profile: { require_trusted_seed: true } },
    );
    assert.equal(drop, "Outside trusted reward program seed list.");
  });

  it("ranks rewarded shortlist by payout amount when enabled", () => {
    const base = {
      issue_title: "Paid bounty task with enough title length",
      latest_repo_activity_at: "2026-05-30T00:00:00.000Z",
      latest_maintainer_activity_at: "2026-05-31T00:00:00.000Z",
      source_observations: [
        { kind: "trusted_seed_list", value: "rewarded-programs", repo: "calcom/cal.com" },
        { kind: "reward_signal", value: "label:bounty", confidence: "OBSERVED" },
      ],
      primary_language: "TypeScript",
      updated_at: "2026-05-30T00:00:00.000Z",
      requires_private_credentials: false,
      claimed_in_comments: false,
      linked_prs: [],
      archived: false,
      issue_state: "open",
      assignees: [],
      collection_status: "OBSERVED",
      has_verified_reward_signal: true,
      has_inferred_reward_signal: true,
      reward_signals: [{ kind: "label", value: "bounty", confidence: "OBSERVED", source_ref: "label:bounty" }],
    };

    const ranked = triageCandidates(
      [
        { ...base, candidate_id: "SCOUT-low", estimated_reward_usd: 50 },
        { ...base, candidate_id: "SCOUT-high", estimated_reward_usd: 500 },
      ],
      {
        profile: createSearchProfile({ name: "rewarded-trusted-only" }),
        now: new Date("2026-06-04T00:00:00.000Z"),
      },
    );

    assert.equal(ranked[0].candidate_id, "SCOUT-high");
    assert.equal(ranked[1].candidate_id, "SCOUT-low");
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[1].rank, 2);
  });
});
