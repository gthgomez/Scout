# Troubleshooting

Practical fixes for common Scout run issues. For setup and quick start, see [`README.md`](README.md).

## GitHub API rate limits

GitHub has two limits to distinguish:

- **Primary rate limit**: 30 search requests/min unauthenticated, 5000/hr authenticated. Returns `403` with a rate-limit payload (or `429`).
- **Secondary rate limit**: `403`/`429` whose body contains `"secondary rate limit"`. Triggered by bursty or concurrent traffic; GitHub does not publish the window.

Scout handles these automatically: it paces queries (`SCOUT_SEARCH_PACE_MS`, default 4000), retries retryable errors (`SCOUT_SEARCH_MAX_RETRIES`, default 3), and backs off with an escalating cooldown after secondary hits (`SCOUT_SEARCH_SECONDARY_COOLDOWN_MS`, default 60000, capped at 120s). After a 403-heavy run, GitHub may keep you in cooldown — wait 30–60 minutes before retrying.

**Symptom**: `run_status` is `"partial"` with entries in `collection_errors` — check each entry's `error_kind` (`primary_rate_limit`, `secondary_rate_limit`, or `search_failed`).

## 422 errors on seed repos

GitHub search returns `422` for certain org/repo queries. Known cases:

- `calcom/cal.com` — historically problematic; fixed via an org-scoped query override.
- `unkeydev/unkey` and `formancehq/formance` — removed from the seeds.

**Fix**: prune the repo from the lists in `src/scout/seed-lists/*.json`, or add a per-repo query override for it in `src/scout/profiles.js`.

## Cache

Scout keeps a disk cache at `.scout/cache/github/` (search results TTL 24h, metadata TTL 6h; tune with `SCOUT_CACHE_TTL_SEARCH` / `SCOUT_CACHE_TTL_METADATA`).

- Force a fresh fetch for one run with `--no-cache`.
- Delete `.scout/cache/github/` to nuke the whole cache.

## `full` preset silently falls back to `fast`

Without `GITHUB_TOKEN`/`GH_TOKEN`, `workflow run` cannot fetch static archives, so the `full` preset silently degrades to `fast` — `handoff_mode` will be `metadata_only` with no static inspection evidence. Run with a token to get static evidence in the handoff.

## Benchmarks & seeds

- Weekly benchmark: `node scripts/benchmark-rewarded-hunt.mjs --lane nocache`
- Seed health: `node scripts/audit-seed-queries.mjs --profile rewarded-cash-in`
- Targets and scheduler setup: [`docs/income-ops.md`](docs/income-ops.md)

## Where outputs land

- `session --out-dir` — the session bundle (reports, handoff package)
- `.scout/` — runtime state (cache, probe artifacts)
- `reports/` — ad-hoc dumps from scripts and tools
