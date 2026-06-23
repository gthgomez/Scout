import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySearchError,
  computeSearchRetryDelayMs,
  createSearchSessionGuard,
  computeSecondarySessionCooldownMs,
  isRetryableSearchError,
  parseRetryAfterSeconds,
  resolveSearchPaceMs,
  resolveSearchSecondaryCooldownMs,
} from "../github-search-policy.js";

describe("github-search-policy", () => {
  it("classifies secondary rate limit 403", () => {
    const error = {
      status: 403,
      body: "You have exceeded a secondary rate limit. Please wait.",
    };
    assert.equal(classifySearchError(error), "secondary_rate_limit");
    assert.equal(isRetryableSearchError(error), true);
  });

  it("classifies primary search exhaustion", () => {
    const error = {
      status: 403,
      body: "API rate limit exceeded",
      rate_limit: { resource: "search", remaining: 0, limit: 30 },
    };
    assert.equal(classifySearchError(error), "primary_rate_limit");
    assert.equal(isRetryableSearchError(error), true);
  });

  it("does not retry non-retryable auth failures", () => {
    const error = {
      status: 403,
      body: "Bad credentials",
      rate_limit: { resource: "search", remaining: 20, limit: 30 },
    };
    assert.equal(classifySearchError(error), "search_failed");
    assert.equal(isRetryableSearchError(error), false);
  });

  it("retries 429 responses", () => {
    const error = { status: 429, body: "Too many requests" };
    assert.equal(isRetryableSearchError(error), true);
  });

  it("parses retry-after header", () => {
    assert.equal(parseRetryAfterSeconds({ get: () => "12" }), 12);
    assert.equal(parseRetryAfterSeconds({ get: () => null }), null);
  });

  it("caps retry delay with retry-after", () => {
    assert.equal(computeSearchRetryDelayMs(0, 90), 60_000);
    assert.equal(computeSearchRetryDelayMs(0, 5), 5000);
  });

  it("defaults search pace to 4000ms", () => {
    const prev = process.env.SCOUT_SEARCH_PACE_MS;
    delete process.env.SCOUT_SEARCH_PACE_MS;
    try {
      assert.equal(resolveSearchPaceMs(), 4000);
    } finally {
      if (prev === undefined) delete process.env.SCOUT_SEARCH_PACE_MS;
      else process.env.SCOUT_SEARCH_PACE_MS = prev;
    }
  });

  it("resolves secondary cooldown from env with default 60000", () => {
    const prev = process.env.SCOUT_SEARCH_SECONDARY_COOLDOWN_MS;
    delete process.env.SCOUT_SEARCH_SECONDARY_COOLDOWN_MS;
    try {
      assert.equal(resolveSearchSecondaryCooldownMs(), 60_000);
      process.env.SCOUT_SEARCH_SECONDARY_COOLDOWN_MS = "45000";
      assert.equal(resolveSearchSecondaryCooldownMs(), 45_000);
      assert.equal(resolveSearchSecondaryCooldownMs(30_000), 30_000);
    } finally {
      if (prev === undefined) delete process.env.SCOUT_SEARCH_SECONDARY_COOLDOWN_MS;
      else process.env.SCOUT_SEARCH_SECONDARY_COOLDOWN_MS = prev;
    }
  });

  it("createSearchSessionGuard enforces inter-request pace", async () => {
    const guard = createSearchSessionGuard({ paceMs: 40, secondaryCooldownMs: 0 });
    const started = Date.now();
    await guard.paceSearch();
    await guard.paceSearch();
    assert.ok(Date.now() - started >= 35);
  });

  it("createSearchSessionGuard applies session cooldown after secondary limit hit", async () => {
    const guard = createSearchSessionGuard({ paceMs: 0, secondaryCooldownMs: 50 });
    guard.onSecondaryLimitHit();
    const started = Date.now();
    await guard.paceSearch();
    assert.ok(Date.now() - started >= 45);
  });

  it("computeSecondarySessionCooldownMs bumps exponentially and caps at 120s", () => {
    assert.equal(computeSecondarySessionCooldownMs(1, 40_000), 40_000);
    assert.equal(computeSecondarySessionCooldownMs(2, 40_000), 80_000);
    assert.equal(computeSecondarySessionCooldownMs(3, 40_000), 120_000);
    assert.equal(computeSecondarySessionCooldownMs(4, 40_000), 120_000);
  });
});
