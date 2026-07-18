import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIncomeActionSummary,
  buildWebhookPayload,
  rankActionableDecisions,
  renderIncomeScorecardMarkdown,
} from "../income-ops.js";

describe("income-ops helpers", () => {
  const report = {
    run_status: "complete",
    discovery_intent: "rewarded",
    profile: { profile_id: "profile-rewarded-cash-in" },
    candidates: [
      {
        candidate_id: "SCOUT-acme-tool-1",
        repo_owner: "acme",
        repo_name: "tool",
        issue_number: 1,
        issue_title: "Easy bounty",
        estimated_reward_usd: 50,
        roi_score: 12,
        reward_signals: [{ kind: "platform_url", value: "https://algora.io/b/1", platform: "algora" }],
      },
      {
        candidate_id: "SCOUT-acme-tool-2",
        repo_owner: "acme",
        repo_name: "tool",
        issue_number: 2,
        issue_title: "Hard bounty",
        estimated_reward_usd: 500,
        roi_score: 5,
      },
    ],
    decisions: [
      { candidate_id: "SCOUT-acme-tool-1", verdict: "GREEN", score: 80, roi_score: 12, estimated_reward_usd: 50 },
      { candidate_id: "SCOUT-acme-tool-2", verdict: "YELLOW", score: 60, roi_score: 5, estimated_reward_usd: 500 },
      { candidate_id: "SCOUT-acme-tool-3", verdict: "RED", score: 10 },
    ],
    monitor_events: [{ change_type: "new_candidate" }, { change_type: "verdict_improved" }],
  };

  it("ranks GREEN above YELLOW and prefers higher ROI", () => {
    const ranked = rankActionableDecisions(report, { includeYellow: true, limit: 5 });
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].candidate_id, "SCOUT-acme-tool-1");
    assert.equal(ranked[0].platform_url, "https://algora.io/b/1");
  });

  it("builds webhook payload with top candidate fields", () => {
    const summary = buildIncomeActionSummary(report);
    const payload = buildWebhookPayload({ mode: "daily", report, summary });
    assert.equal(payload.source, "scout-income-ops");
    assert.equal(payload.actionable, true);
    assert.equal(payload.top_candidate_id, "SCOUT-acme-tool-1");
    assert.equal(payload.top_verdict, "GREEN");
    assert.equal(payload.monitor_actionable_count, 2);
    assert.match(payload.next_step, /act-top1/);
  });

  it("renders scorecard markdown", () => {
    const md = renderIncomeScorecardMarkdown({
      generated_at: "2026-07-18T00:00:00.000Z",
      claims: {
        total_claims: 1,
        in_flight: 0,
        paid_count: 1,
        paid_usd_sum: 50,
        active_skip_keys: 1,
        by_status: { researching: 0, claimed: 0, pr_open: 0, merged: 0, paid: 1, abandoned: 0 },
      },
      last_watch: null,
      benchmark_summary: null,
    });
    assert.match(md, /Paid count/);
    assert.match(md, /50/);
  });
});
