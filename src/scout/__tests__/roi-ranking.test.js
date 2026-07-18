import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachRoiFields,
  computeClaimFrictionScore,
  computeEffortEstimate,
  computeRoiScore,
  computeRoiScoreInferred,
  computeStackFitScore,
  isStaleClaimOpportunity,
} from "../roi-ranking.js";

const NOW = new Date("2026-06-04T00:00:00.000Z");

describe("roi ranking heuristics", () => {
  it("estimates lower effort for small issues and higher for complex labels", () => {
    const small = computeEffortEstimate({
      issue_body: "Fix typo",
      labels: ["good first issue"],
      estimated_files_touched: 1,
    });
    const large = computeEffortEstimate({
      issue_body: "x".repeat(3500),
      labels: ["epic", "refactor"],
      estimated_files_touched: 6,
      comment_count: 25,
    });

    assert.equal(small, 1);
    assert.equal(large, 22);
  });

  it("returns null effort when a linked PR likely solves the issue", () => {
    assert.equal(
      computeEffortEstimate({
        linked_prs: [{ likely_solves_issue: true }],
      }),
      null,
    );
  });

  it("scores claim friction from platform and assignment signals", () => {
    const easy = computeClaimFrictionScore(
      {
        reward_signals: [{ kind: "platform_url", value: "https://algora.io/bounties/x" }],
        has_verified_reward_signal: true,
        assignees: [],
        latest_maintainer_activity_at: "2026-06-01T00:00:00.000Z",
        comment_count: 2,
        discovered_by_query: "repo:acme/tooling is:issue state:open no:assignee",
      },
      { now: NOW },
    );
    const hard = computeClaimFrictionScore(
      {
        claimed_in_comments: true,
        linked_prs: [{ likely_solves_issue: true }],
      },
      { now: NOW },
    );

    assert.equal(easy, 85);
    assert.equal(hard, 0);
  });

  it("boosts stale claimed issues with low open-pr competition", () => {
    const stale = computeClaimFrictionScore(
      {
        assignees: ["hunter"],
        has_attempt_comment: true,
        last_comment_at: "2026-05-01T00:00:00.000Z",
        linked_prs: [],
        comment_count: 2,
        source_observations: [{ kind: "trusted_seed_list", value: "rewarded-programs", repo: "acme/app" }],
      },
      { now: NOW, staleClaimDays: 14 },
    );
    assert.equal(stale, 35);
    assert.equal(
      isStaleClaimOpportunity(
        {
          assignees: ["hunter"],
          last_comment_at: "2026-05-01T00:00:00.000Z",
          linked_prs: [],
        },
        { now: NOW, staleClaimDays: 14 },
      ),
      true,
    );
  });

  it("scores stack fit from preferred and excluded languages", () => {
    const profile = {
      preferred_languages: ["TypeScript"],
      excluded_languages: ["Rust"],
      min_repo_stars: 100,
      max_repo_stars: 50000,
    };
    const fit = computeStackFitScore(
      { primary_language: "TypeScript", repo_stars: 1000 },
      profile,
    );
    const poor = computeStackFitScore(
      { primary_language: "Rust", repo_stars: 10 },
      profile,
    );

    assert.equal(fit, 100);
    assert.equal(poor, 10);
  });

  it("computes roi as reward divided by effort", () => {
    assert.equal(
      computeRoiScore({
        estimated_reward_usd: 200,
        issue_body: "Small fix",
        labels: ["good first issue"],
      }),
      200,
    );
    assert.equal(
      computeRoiScore({
        estimated_reward_usd: 100,
        issue_body: "x".repeat(3500),
        labels: ["epic"],
      }),
      100 / 14,
    );
  });

  it("computes inferred roi for non-USD rewards with currency tier", () => {
    const rtc = computeRoiScoreInferred({
      estimated_reward_amount: 100,
      reward_currency: "RTC",
      issue_body: "Small fix",
      labels: ["good first issue"],
    });
    assert.equal(rtc?.roi_score, null);
    assert.equal(rtc?.roi_confidence, "RTC");
    assert.ok(rtc?.roi_score_inferred > 0);
    assert.ok(rtc.roi_score_inferred < 10);
  });

  it("attaches roi fields on candidates", () => {
    const candidate = {
      estimated_reward_usd: 50,
      issue_body: "Patch docs",
      labels: ["documentation"],
      primary_language: "TypeScript",
    };
    attachRoiFields(candidate, { preferred_languages: ["TypeScript"] }, { now: NOW });
    assert.equal(candidate.estimated_effort_hours, 1);
    assert.equal(typeof candidate.claim_friction_score, "number");
    assert.equal(candidate.stack_fit_score, 80);
    assert.equal(candidate.roi_score, 50);
  });
});
