import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractRewardSignals } from "../discovery.js";
import { createSearchProfile, presetDefaults, resolveDiscoveryIntent } from "../profiles.js";
import { loadTrustedSeedList } from "../seed-lists.js";
import { buildIncomeSummary, triageCandidate } from "../triage.js";
import { validateSearchProfile } from "../validators.js";

const fixturesPath = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const candidateFixtures = JSON.parse(readFileSync(join(fixturesPath, "candidates.json"), "utf8"));
const NOW = new Date("2026-06-04T00:00:00.000Z");

describe("discovery intent profiles", () => {
  it("defaults missing discovery_intent to beginner", () => {
    const profile = validateSearchProfile({
      profile_id: "profile-legacy",
      name: "legacy",
      mode: "metadata_only",
      languages: ["Python"],
      labels: ["good first issue"],
      include_queries: [],
      exclude_orgs: [],
      exclude_repos: [],
      trusted_seed_lists: [],
      max_candidates: 10,
      threshold_overrides: {},
      created_at: "2026-06-04T00:00:00.000Z",
      updated_at: "2026-06-04T00:00:00.000Z",
    });
    assert.equal(profile.discovery_intent, "beginner");
    assert.equal(resolveDiscoveryIntent(profile), "beginner");
  });

  it("validates discovery_intent enum values", () => {
    const rewarded = createSearchProfile({ name: "rewarded-typescript", discovery_intent: "rewarded" });
    assert.equal(rewarded.discovery_intent, "rewarded");
    assert.throws(
      () =>
        validateSearchProfile({
          ...rewarded,
          discovery_intent: "invalid",
        }),
      /discovery_intent/,
    );
  });

  it("applies beginner and rewarded presets", () => {
    const beginner = createSearchProfile({ name: "beginner-python-ts" });
    const rewarded = createSearchProfile({ name: "rewarded-typescript" });
    assert.equal(beginner.discovery_intent, "beginner");
    assert.deepEqual(beginner.languages, presetDefaults("beginner-python-ts").languages);
    assert.equal(rewarded.discovery_intent, "rewarded");
    assert.ok(rewarded.include_queries.some((query) => query.includes("label:bounty")));
    assert.deepEqual(rewarded.trusted_seed_lists, ["rewarded-programs"]);
  });
});

describe("reward signal extraction", () => {
  it("detects verified label and inferred body reward signals", () => {
    const candidate = {
      issue_title: "Fix checkout bug",
      labels: ["bounty", "good first issue"],
    };
    const result = extractRewardSignals(candidate, "This issue pays $200 for a fix via Algora.");
    assert.equal(result.has_verified_reward_signal, true);
    assert.equal(result.has_inferred_reward_signal, true);
    assert.equal(result.estimated_reward_usd, 200);
    assert.ok(result.reward_signals.some((signal) => signal.kind === "label"));
    assert.ok(result.source_observations.some((item) => item.kind === "reward_signal"));
  });

  it("parses currency amounts from titles as inferred rewards", () => {
    const result = extractRewardSignals({ issue_title: "Paid task: $500 bounty", labels: [] }, "");
    assert.equal(result.estimated_reward_usd, 500);
    assert.equal(result.has_verified_reward_signal, true);
  });
});

describe("intent-aware triage", () => {
  it("ranks rewarded candidates with signals above no-signal candidates", () => {
    const withSignal = triageCandidate(
      {
        ...candidateFixtures.greenCandidate,
        labels: ["bounty"],
        has_verified_reward_signal: true,
        has_inferred_reward_signal: true,
        reward_signals: [{ kind: "label", value: "bounty", confidence: "OBSERVED", source_ref: "label:bounty" }],
        estimated_reward_usd: 200,
        source_observations: [{ kind: "reward_signal", value: "label:bounty", confidence: "OBSERVED" }],
      },
      { profile: { discovery_intent: "rewarded" }, now: NOW },
    );
    const withoutSignal = triageCandidate(
      { ...candidateFixtures.greenCandidate, has_verified_reward_signal: false, has_inferred_reward_signal: false },
      { profile: { discovery_intent: "rewarded" }, now: NOW },
    );
    assert.ok(["GREEN", "YELLOW"].includes(withSignal.verdict));
    assert.equal(withoutSignal.verdict, "GRAY");
    assert.ok(withoutSignal.gap_codes.includes("REWARD_GAP"));
    assert.ok((withSignal.score ?? 0) > (withoutSignal.score ?? 0));
  });

  it("adds income_summary for rewarded decisions with signals", () => {
    const decision = triageCandidate(
      {
        ...candidateFixtures.greenCandidate,
        has_verified_reward_signal: true,
        has_inferred_reward_signal: true,
        reward_signals: [{ kind: "label", value: "bounty", confidence: "OBSERVED", source_ref: "label:bounty" }],
        estimated_reward_usd: 150,
      },
      { profile: { discovery_intent: "rewarded" }, now: NOW },
    );
    const summary = buildIncomeSummary({
      has_verified_reward_signal: true,
      has_inferred_reward_signal: true,
      reward_signals: [{ kind: "label", value: "bounty", confidence: "OBSERVED" }],
      estimated_reward_usd: 150,
    });
    assert.ok(decision.income_summary?.includes("Scout does not verify payout"));
    assert.ok(summary?.includes("$150"));
  });

  it("keeps beginner hard drops unchanged for both intents", () => {
    const beginnerDrop = triageCandidate(fixturesPrivate(), { profile: { discovery_intent: "beginner" }, now: NOW });
    const rewardedDrop = triageCandidate(fixturesPrivate(), { profile: { discovery_intent: "rewarded" }, now: NOW });
    assert.equal(beginnerDrop.verdict, "RED");
    assert.equal(rewardedDrop.verdict, "RED");
    assert.equal(beginnerDrop.gap_codes[0], "SECURITY_GAP");
    assert.equal(rewardedDrop.gap_codes[0], "SECURITY_GAP");
  });
});

describe("rewarded seed list", () => {
  it("loads rewarded-programs packaged seed list", async () => {
    const seedList = await loadTrustedSeedList("rewarded-programs");
    assert.equal(seedList.seed_list_id, "rewarded-programs");
    assert.ok(seedList.repos.length >= 5);
    assert.ok(seedList.repos.some((entry) => (entry.labels ?? []).includes("bounty")));
  });
});

function fixturesPrivate() {
  return candidateFixtures.privateCredentialCandidate;
}
