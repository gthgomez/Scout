import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { hardDropReason, portfolioValueScore, scoreCandidate, triageCandidate, triageCandidates } from "../triage.js";

const fixtures = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "candidates.json"), "utf8"),
);
const NOW = new Date("2026-06-04T00:00:00.000Z");

describe("candidate scoring", () => {
  it("rewards a strong evidence-heavy candidate", () => {
    const result = scoreCandidate(fixtures.greenCandidate, { now: NOW });
    assert.equal(result.score, 100);
    assert.ok(result.reasons.includes("+25 issue clarity"));
    assert.ok(result.reasons.includes("+20 setup docs quality"));
    assert.ok(result.reasons.includes("+15 repo activity"));
    assert.ok(result.reasons.includes("+15 maintainer responsiveness"));
    assert.ok(result.reasons.includes("+10 tests present"));
    assert.ok(result.reasons.includes("+10 stack fit"));
    assert.ok(result.reasons.includes("+5 small file-touch estimate"));
  });

  it("penalizes missing setup docs and private requirements", () => {
    const result = scoreCandidate(
      {
        ...fixtures.privateCredentialCandidate,
        source_observations: [{ kind: "tests_present", value: "Test suite exists" }],
      },
      { now: NOW },
    );
    assert.ok(result.reasons.includes("-25 unclear setup"));
    assert.ok(result.reasons.includes("-30 private credentials required"));
  });

  it("penalizes claimed issues with linked PR and assignment signals", () => {
    const result = scoreCandidate(
      {
        ...fixtures.claimedCandidate,
        linked_prs: [{ likely_solves_issue: true }],
      },
      { now: NOW },
    );
    assert.ok(result.reasons.includes("-40 claimed issue"));
    assert.ok(result.reasons.includes("-50 linked PR likely solves it"));
  });
});

describe("hard drop logic", () => {
  it("returns hard drops for archival and claimed conditions", () => {
    assert.equal(hardDropReason(fixtures.archivedCandidate), "Repository is archived.");
    assert.equal(hardDropReason(fixtures.claimedCandidate), "Issue appears claimed in comments.");
  });

  it("marks hard-drop candidates as RED triage decisions", () => {
    const decision = triageCandidate(fixtures.privateCredentialCandidate, { now: NOW });
    assert.equal(decision.verdict, "RED");
    assert.equal(decision.rank, null);
    assert.equal(decision.setup_status, "not_executed");
    assert.equal(decision.human_next_action, "Drop candidate.");
    assert.equal(decision.gap_codes[0], "SECURITY_GAP");
  });

  it("drops trusted seed-list candidates when normal hard-drop conditions apply", () => {
    const seedObservation = { kind: "trusted_seed_list", value: "starter-pack", repo: "alpha/project" };
    const candidates = [
      fixtures.archivedCandidate,
      fixtures.privateCredentialCandidate,
      fixtures.claimedCandidate,
    ].map((candidate) => ({
      ...candidate,
      source_observations: [seedObservation, ...(candidate.source_observations ?? [])],
    }));

    for (const candidate of candidates) {
      const decision = triageCandidate(candidate, { now: NOW });
      assert.equal(decision.verdict, "RED");
      assert.equal(decision.human_next_action, "Drop candidate.");
    }
  });
});

describe("triage ranking", () => {
  it("ranks by verdict and score with RED candidates unranked", () => {
    const candidates = [
      fixtures.greenCandidate,
      fixtures.partialCandidate,
      fixtures.staleCandidate,
      fixtures.archivedCandidate,
    ];

    const ranked = triageCandidates(candidates, { now: NOW });
    assert.equal(ranked[0].verdict, "GREEN");
    assert.equal(ranked[1].verdict, "YELLOW");
    assert.equal(ranked[2].verdict, "GRAY");
    assert.equal(ranked[3].verdict, "RED");
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[1].rank, 2);
    assert.equal(ranked[2].rank, 3);
    assert.equal(ranked[3].rank, null);
  });

  it("returns portfolio scores for decision summaries", () => {
    const decision = triageCandidate(fixtures.greenCandidate, { now: NOW });
    assert.equal(typeof decision.portfolio_score, "number");
    assert.ok(Array.isArray(decision.portfolio_reasons));
    assert.ok(portfolioValueScore(fixtures.greenCandidate).portfolio_reasons.length > 0);
  });

  it("does not mark observed candidates GREEN without setup guidance", () => {
    const decision = triageCandidate(
      {
        ...fixtures.greenCandidate,
        candidate_id: "SCOUT-alpha-no-setup-1",
        source_observations: [],
      },
      { now: NOW },
    );

    assert.equal(decision.verdict, "YELLOW");
    assert.equal(decision.setup_status, "unknown");
    assert.ok(decision.gap_codes.includes("SOURCE_GAP"));
  });

  it("uses green_min_score overrides when deciding GREEN eligibility", () => {
    const decision = triageCandidate(fixtures.greenCandidate, {
      now: NOW,
      threshold_overrides: { green_min_score: 101 },
    });

    assert.equal(decision.score, 100);
    assert.equal(decision.verdict, "YELLOW");
    assert.equal(decision.threshold_policy.effective_thresholds.green_min_score, 101);
  });

  it("lets stale threshold overrides remove stale penalties only when setup and score gates pass", () => {
    const permissive = triageCandidate(fixtures.staleCandidate, {
      now: NOW,
      threshold_overrides: { max_issue_age_days: 700 },
    });
    const missingSetup = triageCandidate(
      {
        ...fixtures.staleCandidate,
        source_observations: [],
      },
      {
        now: NOW,
        threshold_overrides: { max_issue_age_days: 700 },
      },
    );

    assert.equal(permissive.verdict, "GREEN");
    assert.ok(!permissive.score_reasons.includes("-20 stale issue"));
    assert.equal(missingSetup.verdict, "YELLOW");
    assert.equal(missingSetup.setup_status, "unknown");
  });

  it("keeps hard-drop candidates RED regardless of permissive threshold overrides", () => {
    const decision = triageCandidate(fixtures.privateCredentialCandidate, {
      now: NOW,
      threshold_overrides: {
        green_min_score: 0,
        max_issue_age_days: 9999,
        recent_repo_activity_days: 9999,
        recent_maintainer_activity_days: 9999,
        min_issue_title_length: 0,
        max_estimated_files_touched: 9999,
      },
    });

    assert.equal(decision.verdict, "RED");
    assert.equal(decision.drop_reason, "Work appears to require private credentials or paid services.");
  });
});

describe("broad-query GREEN quality gate", () => {
  const rewardedBroadProfile = {
    discovery_intent: "rewarded",
    require_trusted_or_platform_for_broad_green: true,
    broad_green_min_usd: 25,
  };

  function rustchainLabelOnlyCandidate() {
    return {
      ...fixtures.greenCandidate,
      candidate_id: "SCOUT-rustchain-label-1",
      repo_owner: "Scottcjn",
      repo_name: "rustchain-bounties",
      issue_title: "[BOUNTY: 5 RTC] Improve wallet sync reliability",
      discovered_by_query: 'label:bounty is:issue state:open no:assignee',
      has_verified_reward_signal: true,
      has_inferred_reward_signal: true,
      estimated_reward_usd: null,
      reward_signals: [
        { kind: "label", value: "bounty", confidence: "OBSERVED", source_ref: "label:bounty" },
      ],
      source_observations: [
        ...(fixtures.greenCandidate.source_observations ?? []),
        { kind: "reward_signal", value: "label:bounty", confidence: "OBSERVED" },
      ],
    };
  }

  function appwriteAlgoraCandidate() {
    return {
      ...fixtures.greenCandidate,
      candidate_id: "SCOUT-appwrite-algora-1",
      repo_owner: "appwrite",
      repo_name: "appwrite",
      discovered_by_query: 'label:algora is:issue state:open no:assignee',
      has_verified_reward_signal: true,
      has_inferred_reward_signal: true,
      reward_signals: [
        {
          kind: "platform_url",
          value: "https://console.algora.io/org/appwrite/bounties/abc123",
          confidence: "OBSERVED",
          source_ref: "issue_body",
          platform: "algora",
        },
        { kind: "label", value: "algora", confidence: "OBSERVED", source_ref: "label:algora" },
      ],
      source_observations: [
        ...(fixtures.greenCandidate.source_observations ?? []),
        {
          kind: "reward_signal",
          value: "platform_url:https://console.algora.io/org/appwrite/bounties/abc123",
          confidence: "OBSERVED",
        },
      ],
    };
  }

  it("caps label-only broad-query candidates at YELLOW (rustchain-style)", () => {
    const decision = triageCandidate(rustchainLabelOnlyCandidate(), {
      profile: rewardedBroadProfile,
      now: NOW,
    });

    assert.equal(decision.verdict, "YELLOW");
    assert.ok(decision.risk_summary.includes("Broad-query reward candidate"));
    assert.ok(decision.gap_codes.includes("REWARD_GAP"));
  });

  it("allows GREEN for broad-query candidates with platform URL (Appwrite + Algora)", () => {
    const decision = triageCandidate(appwriteAlgoraCandidate(), {
      profile: rewardedBroadProfile,
      now: NOW,
    });

    assert.equal(decision.verdict, "GREEN");
  });

  it("keeps trusted-seed label-only candidates eligible for GREEN", () => {
    const decision = triageCandidate(
      {
        ...rustchainLabelOnlyCandidate(),
        discovered_by_query: "repo:appwrite/appwrite is:issue state:open no:assignee",
        source_observations: [
          ...(fixtures.greenCandidate.source_observations ?? []),
          { kind: "trusted_seed_list", value: "rewarded-programs", repo: "appwrite/appwrite" },
          { kind: "reward_signal", value: "label:bounty", confidence: "OBSERVED" },
        ],
      },
      { profile: rewardedBroadProfile, now: NOW },
    );

    assert.equal(decision.verdict, "GREEN");
  });

  it("allows GREEN when broad candidate meets broad_green_min_usd", () => {
    const decision = triageCandidate(
      {
        ...rustchainLabelOnlyCandidate(),
        estimated_reward_usd: 50,
        reward_signals: [
          { kind: "label", value: "bounty", confidence: "OBSERVED", source_ref: "label:bounty" },
          { kind: "amount", value: "$50", confidence: "OBSERVED", source_ref: "issue_title" },
        ],
      },
      { profile: rewardedBroadProfile, now: NOW },
    );

    assert.equal(decision.verdict, "GREEN");
  });
});
