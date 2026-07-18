import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchAlgoraApiMetadata,
  parseAlgoraApiResponse,
  parseAlgoraBountySlug,
} from "../algora-api-enrich.js";
import { applyAlgoraPlatformEnrich } from "../algora-enrich.js";
import { defaultPolicy } from "../policy.js";

describe("algora api enrich spike", () => {
  it("parses bounty slug from public URLs", () => {
    assert.equal(parseAlgoraBountySlug("https://algora.io/bounties/acme/demo-1"), "acme");
    assert.equal(parseAlgoraBountySlug("https://www.algora.io/bounties/demo-1/extra"), "demo-1");
  });

  it("parses API JSON payloads", () => {
    const parsed = parseAlgoraApiResponse({
      bounty: { status: "open", amountUsd: 120 },
    });
    assert.equal(parsed.status, "open");
    assert.equal(parsed.amount, 120);
  });

  it("prefers API metadata when key is configured", async () => {
    const previous = process.env.ALGORA_API_KEY;
    process.env.ALGORA_API_KEY = "test-key";
    try {
      const candidate = {
        candidate_id: "SCOUT-demo-api",
        reward_signals: [
          {
            kind: "platform_url",
            platform: "algora",
            value: "https://algora.io/bounties/demo-1",
          },
        ],
      };
      const enriched = await applyAlgoraPlatformEnrich({
        candidate,
        policy: defaultPolicy("metadata_only"),
        fetchImpl: async (url) => {
          if (String(url).includes("api.algora.io")) {
            return {
              ok: true,
              text: async () => JSON.stringify({ bounty: { status: "open", amountUsd: 150 } }),
            };
          }
          return { ok: false, text: async () => "" };
        },
      });
      assert.equal(enriched.platform_status_observed, "open");
      assert.equal(enriched.platform_amount_observed, 150);
      assert.ok(
        enriched.source_observations.some(
          (obs) => obs.kind === "platform_amount" && obs.confidence === "OBSERVED",
        ),
      );
      assert.equal(enriched.payout_verified_externally, false);
    } finally {
      if (previous === undefined) {
        delete process.env.ALGORA_API_KEY;
      } else {
        process.env.ALGORA_API_KEY = previous;
      }
    }
  });

  it("returns null without API key", async () => {
    const previous = process.env.ALGORA_API_KEY;
    delete process.env.ALGORA_API_KEY;
    delete process.env.SCOUT_ALGORA_API_KEY;
    try {
      const result = await fetchAlgoraApiMetadata({
        url: "https://algora.io/bounties/demo-1",
        fetchImpl: async () => {
          throw new Error("should not fetch");
        },
      });
      assert.equal(result, null);
    } finally {
      if (previous !== undefined) {
        process.env.ALGORA_API_KEY = previous;
      }
    }
  });
});
