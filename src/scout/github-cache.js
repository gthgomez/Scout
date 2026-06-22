import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_TTL_SEARCH_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TTL_METADATA_MS = 6 * 60 * 60 * 1000;

function ttlForCategory(category) {
  if (category === "search") {
    const raw = Number(process.env.SCOUT_CACHE_TTL_SEARCH);
    return Number.isFinite(raw) && raw > 0 ? raw * 1000 : DEFAULT_TTL_SEARCH_MS;
  }
  const raw = Number(process.env.SCOUT_CACHE_TTL_METADATA);
  return Number.isFinite(raw) && raw > 0 ? raw * 1000 : DEFAULT_TTL_METADATA_MS;
}

function cacheKeyForUrl(url) {
  return createHash("sha256").update(String(url)).digest("hex");
}

function cacheKeyForGraphql(query, variables) {
  return createHash("sha256")
    .update(JSON.stringify({ query, variables }))
    .digest("hex");
}

export function createGitHubCache({ cacheDir, enabled = true } = {}) {
  const root = cacheDir ?? join(process.cwd(), ".scout", "cache", "github");

  async function ensureDir() {
    await mkdir(root, { recursive: true });
  }

  function entryPath(key) {
    return join(root, `${key}.json`);
  }

  async function readEntry(key) {
    if (!enabled) return null;
    try {
      const raw = await readFile(entryPath(key), "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function writeEntry(key, entry) {
    if (!enabled) return;
    await ensureDir();
    await writeFile(entryPath(key), JSON.stringify(entry, null, 2), "utf8");
  }

  function isFresh(entry, category) {
    if (!entry?.fetched_at) return false;
    const age = Date.now() - new Date(entry.fetched_at).getTime();
    return age <= ttlForCategory(category);
  }

  return {
    root,
    enabled,
    keyForUrl: cacheKeyForUrl,
    keyForGraphql: cacheKeyForGraphql,
    async getUrl(url, category) {
      const key = cacheKeyForUrl(url);
      const entry = await readEntry(key);
      if (!entry || !isFresh(entry, category)) return { key, entry: null };
      return { key, entry };
    },
    async getGraphql(query, variables) {
      const key = cacheKeyForGraphql(query, variables);
      const entry = await readEntry(key);
      if (!entry || !isFresh(entry, "metadata")) return { key, entry: null };
      return { key, entry };
    },
    async set(key, { body, etag, rate_limit, status = 200, from_cache = false }) {
      await writeEntry(key, {
        body,
        etag: etag ?? null,
        rate_limit: rate_limit ?? null,
        status,
        from_cache,
        fetched_at: new Date().toISOString(),
      });
    },
  };
}
