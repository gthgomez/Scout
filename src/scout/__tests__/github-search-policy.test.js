import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySearchError,
  computeSearchRetryDelayMs,
  isRetryableSearchError,
  parseRetryAfterSeconds,
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
});
