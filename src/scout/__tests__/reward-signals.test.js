import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractPlatformUrls,
  extractRewardSignals,
  parseCryptoRewardAmount,
  parseRewardAmount,
} from "../reward-signals.js";

describe("platform URL reward signals", () => {
  it("detects Algora bounty URL in issue body as verified", () => {
    const result = extractRewardSignals(
      { issue_title: "Fix checkout bug", labels: [] },
      "Claim this at https://algora.io/bounties/org/repo/123",
    );
    assert.equal(result.has_verified_reward_signal, true);
    const platformSignal = result.reward_signals.find((s) => s.kind === "platform_url");
    assert.ok(platformSignal);
    assert.equal(platformSignal.platform, "algora");
    assert.equal(platformSignal.confidence, "OBSERVED");
    assert.equal(platformSignal.source_ref, "issue_body");
    assert.match(platformSignal.value, /algora\.io\/bounties\//i);
  });

  it("detects IssueHunt URL in issue title as verified", () => {
    const result = extractRewardSignals(
      { issue_title: "Bug fix https://issuehunt.io/r/issues/12345", labels: [] },
      "",
    );
    assert.equal(result.has_verified_reward_signal, true);
    const platformSignal = result.reward_signals.find((s) => s.kind === "platform_url");
    assert.ok(platformSignal);
    assert.equal(platformSignal.platform, "issuehunt");
    assert.equal(platformSignal.confidence, "OBSERVED");
    assert.equal(platformSignal.source_ref, "issue_title");
  });

  it("ignores random github.com links", () => {
    const result = extractRewardSignals(
      { issue_title: "See https://github.com/org/repo/issues/1", labels: [] },
      "Also check https://github.com/other/repo",
    );
    assert.equal(result.reward_signals.some((s) => s.kind === "platform_url"), false);
    assert.equal(result.has_verified_reward_signal, false);
  });

  it("extractPlatformUrls detects console.algora.io paths", () => {
    const urls = extractPlatformUrls("View at console.algora.io/bounties/preview/abc");
    assert.equal(urls.length, 1);
    assert.equal(urls[0].platform, "algora");
    assert.match(urls[0].value, /console\.algora\.io/i);
  });

  it("extractPlatformUrls detects opire.dev paths", () => {
    const urls = extractPlatformUrls("Claim at https://opire.dev/bounties/acme/demo");
    assert.equal(urls.length, 1);
    assert.equal(urls[0].platform, "opire");
  });
});

describe("parseRewardAmount", () => {
  it("accepts title amounts with bounty context as OBSERVED", () => {
    const result = parseRewardAmount("Paid task: $500 bounty", "", {});
    assert.equal(result?.amount, 500);
    assert.equal(result?.confidence, "OBSERVED");
    assert.equal(result?.source_ref, "issue_title");
  });

  it("rejects title amounts without bounty context", () => {
    const result = parseRewardAmount("Fix regression in checkout $100", "", {});
    assert.equal(result, null);
  });

  it("accepts title amounts when bounty label signal exists", () => {
    const result = parseRewardAmount("Fix checkout $250", "", {
      labelSignals: [{ kind: "label", value: "bounty", confidence: "OBSERVED" }],
      hasBountyLabel: true,
    });
    assert.equal(result?.amount, 250);
    assert.equal(result?.confidence, "OBSERVED");
  });

  it("discards body-only amounts below $25 without label or platform URL", () => {
    const result = parseRewardAmount("Stack trace regression", "Error at line 7: $7 failed", {});
    assert.equal(result, null);
  });

  it("accepts body amounts within keyword window as INFERRED", () => {
    const result = parseRewardAmount("Fix auth bug", "Algora bounty: $150 for this fix", {});
    assert.equal(result?.amount, 150);
    assert.equal(result?.confidence, "INFERRED");
    assert.equal(result?.source_ref, "issue_body");
  });

  it("prefers the highest contextual amount when multiple match", () => {
    const result = parseRewardAmount(
      "Paid reward: $50",
      "Algora bounty: $300 for the hard fix. Secondary reward $75.",
      {},
    );
    assert.equal(result?.amount, 300);
  });

  it("marks body amounts near platform URLs as OBSERVED", () => {
    const platformUrl = "https://console.algora.io/org/acme/bounties/b-123";
    const body = `See ${platformUrl} for details. Algora bounty pays $200 for this fix.`;
    const urlIndex = body.indexOf(platformUrl);
    const result = parseRewardAmount("Auth bug", body, {
      platformUrls: [{ value: platformUrl, index: urlIndex }],
      hasPlatformUrl: true,
    });
    assert.equal(result?.amount, 200);
    assert.equal(result?.confidence, "OBSERVED");
  });
});

describe("extractRewardSignals amount filtering", () => {
  it("parses $500 from bounty title and marks verified", () => {
    const result = extractRewardSignals({ issue_title: "Paid task: $500 bounty", labels: [] }, "");
    assert.equal(result.estimated_reward_usd, 500);
    assert.equal(result.has_verified_reward_signal, true);
    assert.ok(result.reward_signals.some((signal) => signal.kind === "amount" && signal.value === "$500"));
  });

  it("ignores stack-trace $7 false positives in body-only issues", () => {
    const result = extractRewardSignals(
      { issue_title: "Null pointer in worker", labels: [] },
      "Error at line 7: $7 failed during serialization",
    );
    assert.equal(result.estimated_reward_usd, null);
    assert.equal(result.reward_signals.some((signal) => signal.kind === "amount"), false);
  });

  it("extracts Algora bounty amounts from body text", () => {
    const result = extractRewardSignals(
      { issue_title: "Fix OAuth redirect", labels: [] },
      "Algora bounty: $150 for this fix",
    );
    assert.equal(result.estimated_reward_usd, 150);
    assert.equal(result.estimated_reward_amount, 150);
    assert.equal(result.reward_currency, "USD");
    const amountSignal = result.reward_signals.find((signal) => signal.kind === "amount");
    assert.equal(amountSignal?.confidence, "INFERRED");
    assert.equal(amountSignal?.source_ref, "issue_body");
  });
});

describe("parseCryptoRewardAmount", () => {
  it("parses [BOUNTY: 5 RTC] from title as OBSERVED", () => {
    const result = parseCryptoRewardAmount("[BOUNTY: 5 RTC] Fix wallet sync", "", {});
    assert.equal(result?.amount, 5);
    assert.equal(result?.currency, "RTC");
    assert.equal(result?.value, "5 RTC");
    assert.equal(result?.confidence, "OBSERVED");
    assert.equal(result?.source_ref, "issue_title");
  });

  it("parses USDC amounts from title with bounty context", () => {
    const result = parseCryptoRewardAmount("Paid bounty: 50 USDC for API fix", "", {});
    assert.equal(result?.amount, 50);
    assert.equal(result?.currency, "USDC");
    assert.equal(result?.value, "50 USDC");
  });

  it("parses USDT amounts from body near reward keywords", () => {
    const result = parseCryptoRewardAmount("Auth bug", "Reward pays 100 USDT for this fix", {});
    assert.equal(result?.amount, 100);
    assert.equal(result?.currency, "USDT");
    assert.equal(result?.confidence, "INFERRED");
    assert.equal(result?.source_ref, "issue_body");
  });

  it("rejects crypto amounts without bounty context in title", () => {
    const result = parseCryptoRewardAmount("Fix checkout 50 USDC", "", {});
    assert.equal(result, null);
  });
});

describe("extractRewardSignals non-USD currency", () => {
  it("parses RTC title bounty and leaves estimated_reward_usd null", () => {
    const result = extractRewardSignals(
      { issue_title: "[BOUNTY: 5 RTC] Implement chain bridge", labels: ["bounty"] },
      "",
    );
    assert.equal(result.estimated_reward_usd, null);
    assert.equal(result.estimated_reward_amount, 5);
    assert.equal(result.reward_currency, "RTC");
    assert.equal(result.has_verified_reward_signal, true);
    const amountSignal = result.reward_signals.find((signal) => signal.kind === "amount");
    assert.equal(amountSignal?.value, "5 RTC");
    assert.equal(amountSignal?.currency, "RTC");
  });

  it("parses USDC without setting estimated_reward_usd", () => {
    const result = extractRewardSignals(
      { issue_title: "Bounty: 250 USDC for migration", labels: [] },
      "",
    );
    assert.equal(result.estimated_reward_usd, null);
    assert.equal(result.estimated_reward_amount, 250);
    assert.equal(result.reward_currency, "USDC");
  });

  it("prefers USD over crypto when both appear in title", () => {
    const result = extractRewardSignals(
      { issue_title: "Paid reward $500 or 50 USDC fallback", labels: [] },
      "",
    );
    assert.equal(result.estimated_reward_usd, 500);
    assert.equal(result.reward_currency, "USD");
    assert.equal(result.estimated_reward_amount, 500);
    assert.equal(result.reward_signals.filter((signal) => signal.kind === "amount").length, 1);
  });
});
