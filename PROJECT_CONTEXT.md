# Scout Project Context

## What Scout Is

Scout is a policy-enforced backend for finding open-source contribution candidates. It is orchestrated by AI agent harnesses through runbooks and CLI artifacts — not tied to a single vendor runtime.

Policy gates **Scout CLI operations** only; harnesses must follow runbooks for allowed/denied actions outside Scout.

Current release: **0.3.4** on `main`.

## Discovery Intents

| Intent | Mission | Presets |
| --- | --- | --- |
| `beginner` | Learning-focused contributions | `beginner-python-ts`, `beginner-docs-only`, `beginner-small-repos` |
| `rewarded` | Bounty/reward metadata hunts | `rewarded-typescript`, `rewarded-verified-only` |

## Environment

| Variable | Purpose |
| --- | --- |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub API access; enables default `full` workflow preset |
| `SCOUT_SANDBOX_IMAGE` | Docker probe image override |
| `SCOUT_GITHUB_CONCURRENCY` | Enrichment parallelism (default 4) |
| `SCOUT_ENRICH_MODE` | `auto`, `rest`, or `graphql` |
| `SCOUT_CACHE_TTL_SEARCH` | Search cache TTL seconds (default 86400) |
| `SCOUT_CACHE_TTL_METADATA` | Metadata cache TTL seconds (default 21600) |

## Workflow Presets

| Preset | Stages | Default when |
| --- | --- | --- |
| `fast` | discover → cockpit → handoff | No GitHub token |
| `full` | discover → static (archive) → cockpit → handoff | `GITHUB_TOKEN` or `GH_TOKEN` present |

CLI: `--workflow-preset fast|full`, `--fetch-archives`, `--static-limit N` (defaults to `--shortlist-limit`).

## Agent Artifact Contract

`scout workflow run` writes a session bundle including:

- `scout_session.json` — manifest with `stages_completed`, `workflow_preset_*`, `static_fetch_archives`
- `scout_report.json` / `scout_report.md`
- `scout_static_report.json` when static stage runs with archive fetch
- `handoff_package.json` — **schema 1.1** primary agent entrypoint (`handoff_mode`, `recommended_packages`)
- `scout_cockpit.json` when cockpit stage runs

Handoff 1.1 adds `handoff_mode` (`metadata_only` | `static_verified`, derived from archive-backed static evidence when static stage ran), `handoff_mode_reason` when metadata-only, `recommended_packages`, `suggested_commands`, `schema_version`.

See [`AGENTS.md`](AGENTS.md) for harness routing.

## CLI Surface

| Command | Role |
| --- | --- |
| `scout workflow run [--workflow-preset fast\|full]` | Multi-stage pipeline with token-aware default |
| `scout workflow resume --session ...` | Continue incomplete session |
| `scout discover` / `profile run` | Discovery with `--no-cache`, `--enrich-mode` |
| `scout monitor --skip-known --notify` | Incremental watch (exit 1 on actionable events) |
| `scout inspect --candidate-id ...` | Single-candidate static inspect |
| Other R1–R3 commands | inspect, probe, cockpit, handoff, plan |

## Repository Layout (0.3.x additions)

| Path | Role |
| --- | --- |
| `src/scout/github-client.js` | HTTP/GraphQL transport, cache, concurrency |
| `src/scout/github-cache.js` | Disk cache |
| `src/scout/github-graphql.js` | Batch GraphQL enrichment |
| `src/scout/candidate-metadata.js` | Shared metadata/reward helpers |
| `src/scout/async-pool.js` | Bounded concurrency pool |
| `src/scout/workflow.js` | Pipeline stage orchestration |
| `src/scout/session.js` | Session manifest schema |
| `scripts/benchmark-discovery.ps1` | Discovery mode benchmark |
| `scripts/monitor.ps1` | Scheduled monitor example |
| `AGENTS.md` | Harness routing |
| `.github/workflows/ci-selfhosted.yml` | Self-hosted Windows CI |

## Verification

```powershell
npm run ci
```

Includes `test:policy`. GitHub Actions CI runs on the self-hosted Windows runner only.

## Open Gaps

- Remove `codex_summary.md` in 0.4.0
- JSON Schema validation for handoff/report in 0.4.0
- OpenClaw/Slack notifications (deferred)
