import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimIssueKeys,
  emptyClaimsLedger,
  issueKeyFromClaim,
  loadClaimsLedger,
  normalizeClaimStatus,
  saveClaimsLedger,
  summarizeClaimsLedger,
  upsertClaim,
} from "../claims-ledger.js";

describe("claims ledger", () => {
  it("derives issue keys from urls and candidate ids", () => {
    assert.equal(
      issueKeyFromClaim({
        issue_url: "https://github.com/acme/tooling/issues/42",
      }),
      "acme/tooling#42",
    );
    assert.equal(
      issueKeyFromClaim({
        issue_url: "https://github.com/acme/tooling/issues/42",
        candidate_id: "SCOUT-acme-tooling-42",
      }),
      "acme/tooling#42",
    );
  });

  it("normalizes status aliases to canonical funnel vocabulary", () => {
    assert.equal(normalizeClaimStatus("in_progress"), "claimed");
    assert.equal(normalizeClaimStatus("submitted"), "pr_open");
    assert.equal(normalizeClaimStatus("working"), "claimed");
    assert.equal(normalizeClaimStatus("PR_OPEN"), "pr_open");
  });

  it("upserts claims and returns active issue keys", () => {
    let ledger = emptyClaimsLedger();
    ledger = upsertClaim(ledger, {
      issue_url: "https://github.com/acme/tooling/issues/1",
      candidate_id: "SCOUT-acme-tooling-1",
      status: "in_progress",
    });
    ledger = upsertClaim(ledger, {
      issue_url: "https://github.com/acme/tooling/issues/2",
      status: "abandoned",
    });
    ledger = upsertClaim(ledger, {
      issue_url: "https://github.com/acme/tooling/issues/1",
      status: "submitted",
      pr_url: "https://github.com/acme/tooling/pull/9",
    });

    assert.equal(ledger.claims.length, 2);
    assert.equal(ledger.claims.find((c) => c.issue_url.includes("issues/1")).status, "pr_open");
    assert.deepEqual([...claimIssueKeys(ledger)].sort(), ["acme/tooling#1"]);
  });

  it("summarizes funnel stats including paid amounts", () => {
    let ledger = emptyClaimsLedger();
    ledger = upsertClaim(ledger, {
      issue_url: "https://github.com/acme/tooling/issues/1",
      status: "paid",
      amount_usd: 100,
    });
    ledger = upsertClaim(ledger, {
      issue_url: "https://github.com/acme/tooling/issues/2",
      status: "researching",
    });
    const stats = summarizeClaimsLedger(ledger);
    assert.equal(stats.total_claims, 2);
    assert.equal(stats.paid_count, 1);
    assert.equal(stats.paid_usd_sum, 100);
    assert.equal(stats.in_flight, 1);
    assert.equal(stats.by_status.paid, 1);
  });

  it("persists ledger json under .scout/claims", async () => {
    const root = await mkdtemp(join(tmpdir(), "scout-claims-"));
    try {
      const saved = await saveClaimsLedger(
        upsertClaim(emptyClaimsLedger(), {
          issue_url: "https://github.com/acme/tooling/issues/7",
          status: "paid",
          paid_at: "2026-06-23T00:00:00.000Z",
          amount_usd: 50,
        }),
        root,
      );
      const raw = await readFile(join(root, ".scout", "claims", "ledger.json"), "utf8");
      const parsed = JSON.parse(raw);
      assert.equal(parsed.claims.length, 1);
      assert.equal(saved.claims[0].status, "paid");
      assert.equal(saved.claims[0].amount_usd, 50);
      const loaded = await loadClaimsLedger(root);
      assert.deepEqual([...claimIssueKeys(loaded)], ["acme/tooling#7"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
