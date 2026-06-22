# Scout Project Context

## What Scout Is

Scout is a policy-enforced backend for finding open-source contribution candidates. It is orchestrated by AI agent harnesses through runbooks and CLI artifacts — not tied to a single vendor runtime.

Policy gates **Scout CLI operations** only; harnesses must follow runbooks for allowed/denied actions outside Scout.

Current release: **0.4.1** on `main`.

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
| `SCOUT_WEBHOOK_URL` | Optional user-owned webhook for monitor wrapper (not read by Scout CLI) |

## Workflow Presets

| Preset | Stages | Default when |
| --- | --- | --- |
| `fast` | discover → cockpit → handoff | No GitHub token |
| `full` | discover → static (archive) → cockpit → handoff | `GITHUB_TOKEN` or `GH_TOKEN` present |

CLI: `--workflow-preset fast|full`, `--fetch-archives`, `--static-limit N` (defaults to `--shortlist-limit`).

## Agent Artifact Contract

`scout workflow run` writes a session bundle including:

- `scout_session.json` — manifest (`stages_completed`, `workflow_preset_requested`, `workflow_preset_effective`, `static_fetch_archives`, `artifacts`)
- `scout_report.json` / `scout_report.md` — validated by `validateReportModel` on creation
- `scout_static_report.json` / `.md` when static stage runs with archive fetch
- `scout_cockpit.json` / `.md` when cockpit stage runs
- `handoff_package.json` — schema 1.1 primary agent entrypoint (`handoff_mode`, `handoff_mode_reason`, `recommended_packages`)
- `agent_summary.md` — human/agent-readable session summary
- `scout_shortlist.md`, `next_actions.json`

JSON Schemas: [`schemas/README.md`](schemas/README.md) — handoff 1.1, report 1.0, session 1.0.

See [`AGENTS.md`](AGENTS.md) for harness routing.

## CLI Surface

| Command | Role |
| --- | --- |
| `scout workflow run [--workflow-preset fast\|full]` | Multi-stage pipeline with token-aware default |
| `scout workflow resume --session <dir>` | Continue incomplete session |
| `scout discover` / `profile run` | Discovery with `--no-cache`, `--enrich-mode` |
| `scout inspect` | Static inspection (`--fetch-archives`, `--candidate-id`) |
| `scout monitor --skip-known --notify` | Incremental watch (exit 1 on actionable events) |
| `scout validate-report` | Report schema and decision coverage |
| `scout explain` | Verdict reasoning for one candidate |
| `scout export-shortlist` | Markdown shortlist export |
| `scout cockpit` | Decision cockpit JSON/markdown |
| `scout handoff` | Regenerate `handoff_package.json` from report |
| `scout probe` | Approval-bound Docker probes |
| `scout plan` | Network design / install dry-run planning |
| `scout profile create\|run` | Search profile management |
| `scout run --safe` | Metadata-only quick report |

## Repository Layout (0.4.x)

| Path | Role |
| --- | --- |
| `src/scout/github-client.js` | HTTP/GraphQL transport, cache, concurrency |
| `src/scout/github-cache.js` | Disk cache |
| `src/scout/github-graphql.js` | Batch GraphQL enrichment |
| `src/scout/candidate-metadata.js` | Shared metadata/reward helpers |
| `src/scout/async-pool.js` | Bounded concurrency pool |
| `src/scout/workflow.js` | Pipeline stage orchestration |
| `src/scout/session.js` | Session manifest helpers |
| `schemas/` | JSON Schema contracts + index |
| `scripts/benchmark-discovery.ps1` | Discovery mode benchmark |
| `scripts/monitor.ps1` | Scheduled monitor example |
| `AGENTS.md` | Harness routing |
| `CONTRIBUTING.md` | Contributor and CI setup |
| `.github/workflows/ci-selfhosted.yml` | Self-hosted Windows CI |

## Verification

```powershell
npm run ci
```

Includes `test:policy`. GitHub Actions CI runs on the self-hosted Windows runner only.

## Open Gaps

- OpenClaw/Slack native monitor notifications (deferred; webhook wrapper in monitoring runbook)
