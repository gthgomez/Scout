import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPolicy } from "../policy.js";
import {
  applyAlgoraPlatformEnrich,
  findAlgoraPlatformUrl,
  parseAlgoraPublicPage,
} from "../algora-enrich.js";

describe("algora platform enrich", () => {
  it("finds algora platform URLs on candidates", () => {
    const url = findAlgoraPlatformUrl({
      reward_signals: [
        {
          kind: "platform_url",
          platform: "algora",
          value: "https://algora.io/bounties/demo/1",
        },
      ],
    });
    assert.equal(url, "https://algora.io/bounties/demo/1");
  });

  it("parses status and amount from public page HTML", () => {
    const parsed = parseAlgoraPublicPage(
      '<script>{"status":"open","amountUsd":250}</script><span>$250 bounty</span>',
    );
    assert.equal(parsed.status, "open");
    assert.equal(parsed.amount, 250);
  });

  it("enriches candidate with inferred platform fields and never verifies payout externally", async () => {
    const candidate = {
      candidate_id: "SCOUT-demo-1",
      reward_signals: [
        {
          kind: "platform_url",
          platform: "algora",
          value: "https://algora.io/bounties/demo/1",
        },
      ],
    };
    const enriched = await applyAlgoraPlatformEnrich({
      candidate,
      policy: defaultPolicy("metadata_only"),
      fetchImpl: async () => ({
        ok: true,
        text: async () => '{"status":"open","amountUsd":99}',
      }),
    });
    assert.equal(enriched.platform_status_observed, "open");
    assert.equal(enriched.platform_amount_observed, 99);
    assert.equal(enriched.payout_verified_externally, false);
    assert.ok(enriched.source_observations.some((obs) => obs.confidence === "INFERRED"));
  });

  it("skips enrich when profile flag is off (caller does not invoke)", async () => {
    const candidate = { candidate_id: "SCOUT-demo-2", reward_signals: [] };
    const unchanged = await applyAlgoraPlatformEnrich({
      candidate,
      policy: defaultPolicy("metadata_only"),
    });
    assert.equal(unchanged, candidate);
  });
});
