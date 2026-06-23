import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchContributingMarkdown,
  loadContributingRewardContext,
  mergeContributingRewardFields,
} from "../contributing-prefetch.js";

describe("contributing prefetch", () => {
  it("decodes base64 CONTRIBUTING.md content", async () => {
    const markdown = "# Contributing\n\nWe use https://algora.io/bounties/demo for bounties.";
    const client = {
      fetchJson: async () => ({
        body: {
          encoding: "base64",
          content: Buffer.from(markdown, "utf8").toString("base64"),
        },
      }),
    };

    const text = await fetchContributingMarkdown(client, "acme", "demo");
    assert.match(text, /algora\.io\/bounties\/demo/);
  });

  it("merges platform URLs from CONTRIBUTING into reward fields", () => {
    const rewardFields = {
      reward_signals: [],
      has_verified_reward_signal: false,
      has_observed_reward_metadata: false,
      has_inferred_reward_signal: false,
      source_observations: [],
    };
    const merged = mergeContributingRewardFields(
      { candidate_id: "SCOUT-acme-demo-1" },
      rewardFields,
      {
        path: "CONTRIBUTING.md",
        observations: [
          {
            kind: "reward_signal",
            value: "platform_url:https://algora.io/bounties/acme/demo/1",
            confidence: "OBSERVED",
            source_ref: "CONTRIBUTING.md",
            platform: "algora",
          },
          {
            kind: "contributing_reward_program",
            value: "bounty",
            confidence: "INFERRED",
            source_ref: "CONTRIBUTING.md",
          },
        ],
      },
    );

    assert.equal(merged.has_verified_reward_signal, true);
    assert.equal(merged.has_inferred_reward_signal, true);
    assert.equal(merged.reward_signals.length, 1);
    assert.equal(merged.reward_signals[0].kind, "platform_url");
    assert.equal(merged.reward_signals[0].source_ref, "CONTRIBUTING.md");
  });

  it("loads first available contributing path", async () => {
    const calls = [];
    const client = {
      fetchJson: async (url) => {
        calls.push(url);
        if (String(url).endsWith("/contents/CONTRIBUTING.md")) {
          throw new Error("not found");
        }
        return {
          body: {
            encoding: "base64",
            content: Buffer.from("We run a bounty program via issuehunt", "utf8").toString("base64"),
          },
        };
      },
    };

    const context = await loadContributingRewardContext(client, "acme", "demo");
    assert.equal(calls.length, 2);
    assert.equal(context.path, ".github/CONTRIBUTING.md");
    assert.ok(context.observations.some((item) => item.kind === "contributing_reward_program"));
  });
});
