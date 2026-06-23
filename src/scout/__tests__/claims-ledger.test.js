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
  saveClaimsLedger,
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

  it("upserts claims and returns active issue keys", () => {
    let ledger = emptyClaimsLedger();
    ledger = upsertClaim(ledger, {
      issue_url: "https://github.com/acme/tooling/issues/1",
      candidate_id: "SCOUT-acme-tooling-1",
      status: "claimed",
    });
    ledger = upsertClaim(ledger, {
      issue_url: "https://github.com/acme/tooling/issues/2",
      status: "abandoned",
    });
    ledger = upsertClaim(ledger, {
      issue_url: "https://github.com/acme/tooling/issues/1",
      status: "pr_open",
      pr_url: "https://github.com/acme/tooling/pull/9",
    });

    assert.equal(ledger.claims.length, 2);
    assert.deepEqual([...claimIssueKeys(ledger)].sort(), ["acme/tooling#1"]);
  });

  it("persists ledger json under .scout/claims", async () => {
    const root = await mkdtemp(join(tmpdir(), "scout-claims-"));
    try {
      const saved = await saveClaimsLedger(
        upsertClaim(emptyClaimsLedger(), {
          issue_url: "https://github.com/acme/tooling/issues/7",
          status: "paid",
          paid_at: "2026-06-23T00:00:00.000Z",
        }),
        root,
      );
      const raw = await readFile(join(root, ".scout", "claims", "ledger.json"), "utf8");
      const parsed = JSON.parse(raw);
      assert.equal(parsed.claims.length, 1);
      assert.equal(saved.claims[0].status, "paid");
      const loaded = await loadClaimsLedger(root);
      assert.deepEqual([...claimIssueKeys(loaded)], ["acme/tooling#7"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
