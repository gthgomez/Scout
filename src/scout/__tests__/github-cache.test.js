import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createGitHubCache } from "../github-cache.js";

describe("github-cache", () => {
  it("stores and retrieves URL cache entries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scout-cache-"));
    try {
      const cache = createGitHubCache({ cacheDir: dir, enabled: true });
      const url = "https://api.github.com/repos/acme/tooling";
      const key = cache.keyForUrl(url);
      await cache.set(key, {
        body: { name: "tooling" },
        etag: '"abc"',
        rate_limit: { remaining: 10, limit: 100 },
      });
      const hit = await cache.getUrl(url, "metadata");
      assert.ok(hit.entry);
      assert.equal(hit.entry.body.name, "tooling");
      assert.equal(hit.entry.etag, '"abc"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null for disabled cache", async () => {
    const cache = createGitHubCache({ enabled: false });
    const hit = await cache.getUrl("https://api.github.com/search/issues", "search");
    assert.equal(hit.entry, null);
  });
});
