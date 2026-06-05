import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrustedSeedList, validateTrustedSeedListId } from "../seed-lists.js";

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
});
