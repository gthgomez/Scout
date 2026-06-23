import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isContributingGuidePath,
  scanContributingRewardProgram,
} from "../contributing-reward-scan.js";

describe("contributing reward scan", () => {
  it("recognizes CONTRIBUTING guide paths", () => {
    assert.equal(isContributingGuidePath("CONTRIBUTING.md"), true);
    assert.equal(isContributingGuidePath("tooling-main/CONTRIBUTING.md"), true);
    assert.equal(isContributingGuidePath("README.md"), false);
  });

  it("emits inferred contributing_reward_program observations for bounty keywords", () => {
    const text = [
      "# Contributing",
      "",
      "We run a bounty program via Algora.",
      "Paid contribution opportunities are listed on issuehunt.",
    ].join("\n");

    const observations = scanContributingRewardProgram(text, "CONTRIBUTING.md");

    assert.ok(observations.some((item) => item.kind === "contributing_reward_program" && item.value === "bounty"));
    assert.ok(observations.some((item) => item.kind === "contributing_reward_program" && item.value === "algora"));
    assert.ok(observations.some((item) => item.kind === "contributing_reward_program" && item.value === "paid contribution"));
    assert.ok(observations.some((item) => item.kind === "contributing_reward_program" && item.value === "issuehunt"));
    assert.ok(observations.every((item) => item.confidence === "INFERRED" || item.kind === "reward_signal"));
    assert.ok(observations.every((item) => item.source_ref === "CONTRIBUTING.md"));
  });

  it("emits reward_signal for Algora platform URLs", () => {
    const text = "Apply at https://console.algora.io/bounties/preview/abc123";

    const observations = scanContributingRewardProgram(text, "CONTRIBUTING.md");
    const rewardSignal = observations.find((item) => item.kind === "reward_signal");

    assert.ok(rewardSignal);
    assert.equal(rewardSignal.confidence, "OBSERVED");
    assert.match(rewardSignal.value, /^platform_url:https:\/\/console\.algora\.io\//);
    assert.equal(rewardSignal.platform, "algora");
  });

  it("emits reward_signal for IssueHunt and Opire platform URLs", () => {
    const text = [
      "Bounties: https://issuehunt.io/r/issues/acme-repo-1",
      "Also https://opire.dev/issues/acme/repo/2",
    ].join("\n");

    const observations = scanContributingRewardProgram(text, "CONTRIBUTING.md");
    const issuehunt = observations.find((item) => item.platform === "issuehunt");
    const opire = observations.find((item) => item.platform === "opire");

    assert.ok(issuehunt);
    assert.equal(issuehunt.kind, "reward_signal");
    assert.equal(issuehunt.confidence, "OBSERVED");
    assert.ok(opire);
    assert.equal(opire.kind, "reward_signal");
    assert.equal(opire.confidence, "OBSERVED");
  });

  it("returns no observations for neutral contributing guides", () => {
    const text = [
      "# Contributing",
      "",
      "Fork the repo, open a pull request, and follow the code style guide.",
    ].join("\n");

    assert.deepEqual(scanContributingRewardProgram(text, "CONTRIBUTING.md"), []);
  });

  it("returns no observations for empty text", () => {
    assert.deepEqual(scanContributingRewardProgram("", "CONTRIBUTING.md"), []);
    assert.deepEqual(scanContributingRewardProgram("   ", "CONTRIBUTING.md"), []);
  });
});
