# Scout Project Context

## What Scout Is

Scout is a policy-enforced backend for finding open-source contribution and **paid bounty** candidates. It is orchestrated by AI agent harnesses through runbooks and CLI artifacts — not tied to a single vendor runtime.

Policy gates **Scout CLI operations** only; harnesses must follow runbooks for allowed/denied actions outside Scout.

Current release: **0.6.2** on `main`.

## Discovery Intents

| Intent | Mission | Presets |
| --- | --- | --- |
| `beginner` | Learning-focused contributions | `beginner-python-ts`, `beginner-docs-only`, `beginner-small-repos` |
| `rewarded` | Bounty/reward cash-in hunts | `rewarded-cash-in`, `rewarded-explore`, `rewarded-hunt`, `rewarded-hunt-dev`, `rewarded-trusted-only` |

**Income-first default:** `rewarded-cash-in` (GREEN-only, ROI-ranked, Algora enrich).

## Environment

| Variable | Purpose |
| --- | --- |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub API access; enables default `full` workflow preset |
| `ALGORA_API_KEY` / `SCOUT_ALGORA_API_KEY` | Optional Algora API metadata enrich (falls back to public page scrape) |
| `ALGORA_API_BASE_URL` | Algora API base URL override (default `https://api.algora.io`) |
| `SCOUT_SANDBOX_IMAGE` | Docker probe image override |
| `SCOUT_GITHUB_CONCURRENCY` | Enrichment parallelism (default 4) |
| `SCOUT_ENRICH_MODE` | `auto`, `rest`, or `graphql` |
| `SCOUT_CACHE_TTL_SEARCH` | Search cache TTL seconds (default 86400) |
| `SCOUT_CACHE_TTL_METADATA` | Metadata cache TTL seconds (default 21600) |
| `SCOUT_SEARCH_PACE_MS` | Minimum delay between GitHub search API calls (default 4000) |
| `SCOUT_SEARCH_MAX_RETRIES` | Retries per search query on secondary rate limit (default 3) |
| `SCOUT_SEARCH_SECONDARY_COOLDOWN_MS` | Session cooldown after secondary rate-limit hit (default 60000, cap 120s) |
| Profile `prefetch_contributing` | Fetch CONTRIBUTING.md per repo during rewarded discovery |
| Profile `search_pace_ms` / `search_max_retries` / `search_secondary_cooldown_ms` | Override env search pacing and cooldown for a profile run |
| `SCOUT_WEBHOOK_URL` | Optional user-owned webhook for income-ops/monitor wrapper (not read by Scout CLI) |

## Workflow Presets

| Preset | Stages | Default when |
| --- | --- | --- |
| `fast` | discover → cockpit → handoff | No GitHub token |
| `full` | discover → static (archive) → cockpit → handoff | `GITHUB_TOKEN` or `GH_TOKEN` present |

## Agent Artifact Contract

`scout workflow run` writes a session bundle including:

- `scout_session.json` — manifest
- `scout_report.json` / `scout_report.md`
- `scout_static_report.json` / `.md` when static stage runs
- `scout_cockpit.json` / `.md` when cockpit stage runs
- `handoff_package.json` — schema 1.1/1.2 primary agent entrypoint
- `agent_summary.md`, `scout_shortlist.md`, `next_actions.json`

JSON Schemas: [`schemas/README.md`](schemas/README.md).

## CLI Surface

| Command | Role |
| --- | --- |
| `scout workflow run [--workflow-preset fast\|full]` | Multi-stage pipeline |
| `scout workflow resume --session <dir>` | Continue incomplete session |
| `scout discover` / `profile run` | Discovery |
| `scout monitor --skip-known --notify` | Incremental watch (exit 1 on actionable events) |
| `scout claims list\|add\|update` | Local bounty claim ledger |
| `scout cockpit` / `scout handoff` | Decision drill-down and handoff export |
| `scout probe` | Approval-bound Docker probes |

## Income Ops

- Daily: `pwsh ./scripts/income-ops.ps1 -Mode daily` (monitor + rich webhook + act-top1 dry-run)
- Act: `pwsh ./scripts/income-ops.ps1 -Mode act` / `-ExecuteAct` for full workflow
- Scorecard: `pwsh ./scripts/income-ops.ps1 -Mode scorecard`
- Weekly: `pwsh ./scripts/income-ops.ps1 -Mode weekly` (bench + seed audit + scorecard)
- Claims: `scout claims list|add|update|stats` — statuses `researching→claimed→pr_open→merged→paid|abandoned`
- Docs: [`docs/income-ops.md`](docs/income-ops.md)
- Architecture ADR + phase checklist: [`docs/architecture/`](docs/architecture/)

## Verification

```powershell
npm run ci
```

## Open Gaps

- Native webhook in Scout CLI (wrapper documented; ops wrapper uses `SCOUT_WEBHOOK_URL`)
- Security vuln bounty — separate sibling project (`ScopeHound` spike under `Project_AI/`)
- Income funnel Phase 0 operator gates (schedule + first paid) — see [`docs/architecture/INCOME_FUNNEL_PHASE_CHECKLIST.md`](docs/architecture/INCOME_FUNNEL_PHASE_CHECKLIST.md)
