import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffReports, loadMonitorSnapshot, saveMonitorSnapshot } from "../monitor.js";
import { resolveThresholds } from "../triage.js";

describe("monitor snapshots", () => {
  it("records new candidates and persists local snapshots", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scout-monitor-"));
    try {
      const currentDecision = {
        candidate_id: "SCOUT-alpha-green-1",
        verdict: "GREEN",
        human_next_action: "Review manually before claiming.",
      };
      const events = diffReports([], [currentDecision], "profile-alpha");
      const report = {
        decisions: [currentDecision],
      };
      const path = await saveMonitorSnapshot("Alpha", report, { root: dir });
      const loaded = await loadMonitorSnapshot("Alpha", { root: dir });

      assert.equal(events.length, 1);
      assert.equal(events[0].change_type, "new_candidate");
      assert.ok(path.endsWith(join(".scout", "monitor", "alpha.json")));
      assert.equal(loaded.decisions[0].candidate_id, "SCOUT-alpha-green-1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records candidates missing from the current monitor run", () => {
    const previousDecision = {
      candidate_id: "SCOUT-alpha-old-1",
      verdict: "GREEN",
      human_next_action: "Review manually before claiming.",
    };
    const events = diffReports([previousDecision], [], "profile-alpha");

    assert.equal(events.length, 1);
    assert.equal(events[0].change_type, "candidate_missing");
    assert.equal(events[0].previous_verdict, "GREEN");
    assert.equal(events[0].current_verdict, "GRAY");
  });

  it("marks verdict changes driven by threshold policy changes", () => {
    const previousDecision = {
      candidate_id: "SCOUT-alpha-green-1",
      verdict: "GREEN",
      human_next_action: "Review manually before claiming.",
      threshold_policy: {
        profile_id: "profile-alpha",
        threshold_overrides: {},
        effective_thresholds: resolveThresholds({}),
      },
    };
    const currentDecision = {
      ...previousDecision,
      verdict: "YELLOW",
      threshold_policy: {
        profile_id: "profile-alpha",
        threshold_overrides: { green_min_score: 101 },
        effective_thresholds: resolveThresholds({ green_min_score: 101 }),
      },
    };
    const events = diffReports([previousDecision], [currentDecision], "profile-alpha");

    assert.equal(events.length, 1);
    assert.equal(events[0].change_type, "verdict_downgraded");
    assert.match(events[0].reason, /Threshold policy changed/);
  });
});
