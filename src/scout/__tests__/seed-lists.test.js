import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadTrustedSeedList,
  normalizeSeedRepo,
  queriesForSeedRepo,
  validateSearchQuery,
  validateTrustedSeedListId,
} from "../seed-lists.js";

describe("trusted seed lists", () => {
  it("loads a local seed list from Scout state", async () => {
    const root = mkdtempSync(join(tmpdir(), "scout-seed-list-"));
    try {
      mkdirSync(join(root, ".scout", "seed-lists"), { recursive: true });
      writeFileSync(
        join(root, ".scout", "seed-lists", "starter-pack.json"),
        JSON.stringify({
          seed_list_id: "starter-pack",
          name: "Starter Pack",
          repos: [
            "nodejs/node",
            {
              repo: "pallets/flask",
              labels: ["good first issue"],
              languages: ["Python"],
            },
          ],
        }),
        "utf8",
      );

      const seedList = await loadTrustedSeedList("starter-pack", { root });

      assert.equal(seedList.seed_list_id, "starter-pack");
      assert.equal(seedList.name, "Starter Pack");
      assert.deepEqual(seedList.repos[0], { repo: "nodejs/node" });
      assert.deepEqual(seedList.repos[1], {
        repo: "pallets/flask",
        labels: ["good first issue"],
        languages: ["Python"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects URLs, path traversal, bad repos, and malformed seed-list IDs", async () => {
    assert.throws(() => validateTrustedSeedListId(""), /non-empty/);
    assert.throws(() => validateTrustedSeedListId("https://example.com/list"), /local-safe/);
    assert.throws(() => validateTrustedSeedListId("../starter-pack"), /local-safe/);

    const root = mkdtempSync(join(tmpdir(), "scout-seed-list-bad-"));
    try {
      mkdirSync(join(root, ".scout", "seed-lists"), { recursive: true });
      writeFileSync(
        join(root, ".scout", "seed-lists", "bad-repo.json"),
        JSON.stringify({
          seed_list_id: "bad-repo",
          name: "Bad Repo",
          repos: ["not-a-repo"],
        }),
        "utf8",
      );
      writeFileSync(
        join(root, ".scout", "seed-lists", "missing-id.json"),
        JSON.stringify({
          name: "Missing ID",
          repos: ["nodejs/node"],
        }),
        "utf8",
      );

      await assert.rejects(() => loadTrustedSeedList("bad-repo", { root }), /valid owner\/repo/);
      await assert.rejects(() => loadTrustedSeedList("missing-id", { root }), /non-empty/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads rewarded-programs-algora packaged seed list with 7 repos", async () => {
    const seedList = await loadTrustedSeedList("rewarded-programs-algora");

    assert.equal(seedList.seed_list_id, "rewarded-programs-algora");
    assert.equal(seedList.name, "Algora-active OSS programs");
    assert.equal(seedList.repos.length, 7);
    assert.ok(seedList.repos.some((entry) => entry.repo === "twentyhq/twenty"));
    assert.ok(seedList.repos.some((entry) => entry.repo === "PostHog/posthog"));
    assert.ok(seedList.repos.some((entry) => entry.repo === "golemcloud/golem"));
  });

  it("rewarded-programs-algora has no overlap with rewarded-programs", async () => {
    const [algora, rewarded] = await Promise.all([
      loadTrustedSeedList("rewarded-programs-algora"),
      loadTrustedSeedList("rewarded-programs"),
    ]);

    const algoraRepos = new Set(algora.repos.map((entry) => entry.repo));
    const rewardedRepos = rewarded.repos.map((entry) => entry.repo);
    const overlap = rewardedRepos.filter((repo) => algoraRepos.has(repo));

    assert.deepEqual(overlap, []);
  });

  it("loads rewarded-programs with calcom org-scoped search_query override", async () => {
    const seedList = await loadTrustedSeedList("rewarded-programs");
    const calcom = seedList.repos.find((entry) => entry.repo === "calcom/cal.com");

    assert.ok(calcom);
    assert.equal(calcom.search_query, 'org:calcom is:issue state:open (label:"bounty" OR label:"reward" OR label:"algora" OR label:"paid" OR label:"sponsor" OR label:"issuehunt" OR label:"💰") no:assignee');
  });

  it("queriesForSeedRepo returns search_query override when present", () => {
    const seedRepo = normalizeSeedRepo({
      repo: "calcom/cal.com",
      search_query:
        'org:calcom is:issue state:open (label:"bounty" OR label:"reward" OR label:"algora" OR label:"paid" OR label:"sponsor" OR label:"issuehunt" OR label:"💰") no:assignee',
    });

    assert.deepEqual(queriesForSeedRepo(seedRepo), [
      'org:calcom is:issue state:open (label:"bounty" OR label:"reward" OR label:"algora" OR label:"paid" OR label:"sponsor" OR label:"issuehunt" OR label:"💰") no:assignee',
    ]);
    assert.equal(queriesForSeedRepo({ repo: "appwrite/appwrite" }), null);
  });

  it("validateSearchQuery rejects unsafe or unscoped queries", () => {
    const valid = "org:calcom is:issue state:open no:assignee";
    assert.equal(validateSearchQuery(valid, { repo: "calcom/cal.com" }), valid);

    const labelOr =
      'org:calcom is:issue state:open (label:"bounty" OR label:"reward") no:assignee';
    assert.equal(validateSearchQuery(labelOr, { repo: "calcom/cal.com" }), labelOr);

    assert.throws(
      () => validateSearchQuery("is:issue state:open no:assignee", { repo: "calcom/cal.com" }),
      /repo:- or org:-scoped/,
    );
    assert.throws(
      () => validateSearchQuery("org:evil is:issue state:open", { repo: "calcom/cal.com" }),
      /must match seed repo owner/,
    );
    assert.throws(
      () => validateSearchQuery("org:calcom is:issue state:open; rm -rf /", { repo: "calcom/cal.com" }),
      /unsafe characters/,
    );
    assert.throws(
      () => validateSearchQuery("org:calcom state:open no:assignee", { repo: "calcom/cal.com" }),
      /must include is:issue/,
    );
  });
});
