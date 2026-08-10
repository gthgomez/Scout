# Scout

Scout is a policy-enforced, agent-agnostic local tool for finding paid open-source bounty candidates and handing off to coding agents. Any AI agent harness (Cursor, Claude Code, Gemini, Antigravity, Codex, and others) can orchestrate Scout via runbooks and CLI artifacts.

Policy gates **Scout CLI operations** (allowed/denied commands per runbook role). Agent harnesses must follow runbooks; Scout does not enforce policy inside external coding agents.

**Current release: 0.6.2** — income ops pack (claims stats, act-top1, scorecard, rich webhooks) + lean platform-first cash-in yield.

## Prerequisites

- **Node.js 20+**
- **GitHub token**: copy `.env.example` to `.env` and set `GITHUB_TOKEN` (or `GH_TOKEN`) — required for `full` workflow preset (archive fetch)
- **Docker** (optional): for `scout probe` only — `docker build -t scout-sandbox:latest .`. The built image is used by setting `SCOUT_SANDBOX_IMAGE=scout-sandbox:latest`; the default sandbox image is `node:20-alpine`.
- **Algora API key** (optional): `ALGORA_API_KEY` for platform metadata enrich on `rewarded-cash-in`

## Income-first quick start

Primary profile for cash-in hunts:

```powershell
npm run ci
node src/scout/cli.js workflow run --profile rewarded-cash-in --workflow-preset full --out-dir scout_session
```

Daily monitor + weekly benchmark + scorecard:

```powershell
pwsh ./scripts/income-ops.ps1 -Mode daily
pwsh ./scripts/income-ops.ps1 -Mode act              # dry-run top pick
pwsh ./scripts/income-ops.ps1 -Mode act -ExecuteAct  # full workflow on top pick
pwsh ./scripts/income-ops.ps1 -Mode scorecard
pwsh ./scripts/income-ops.ps1 -Mode weekly
```

See [`docs/income-ops.md`](docs/income-ops.md) for claims ledger vocabulary, act-top1, and scheduler setup.  
Architecture ADR + phase checklist: [`docs/architecture/`](docs/architecture/).

## Agent Runbooks

See [`src/scout/runbooks/README.md`](src/scout/runbooks/README.md) for the full index.

- [Discovery](src/scout/runbooks/discovery-runbook.md)
- [Static Inspection](src/scout/runbooks/static-inspection-runbook.md)
- [Dynamic Probe](src/scout/runbooks/dynamic-probe-runbook.md)
- [Report Review](src/scout/runbooks/report-review-runbook.md)
- [Decision Cockpit](src/scout/runbooks/decision-cockpit-runbook.md)
- [Monitoring](src/scout/runbooks/monitoring-runbook.md)
- [Bounty Claim](src/scout/runbooks/bounty-claim-runbook.md)

Artifact schemas: [`schemas/README.md`](schemas/README.md). Harness routing: [`AGENTS.md`](AGENTS.md) — start from `handoff_package.json`.

## Workflow Presets

| Preset | `--through` | Static archives | Use when |
| --- | --- | --- | --- |
| `fast` | `discover,cockpit,handoff` | skipped | Quick scan, monitor follow-up, no token |
| `full` | `discover,static,cockpit,handoff` | shortlist archive fetch | Before coding-agent handoff |

With `GITHUB_TOKEN` or `GH_TOKEN` set, `workflow run` defaults to **full** preset. Without a token, it defaults to **fast** (metadata-only handoff).

## Discovery Presets

| Preset | Intent | Notes |
| --- | --- | --- |
| `rewarded-cash-in` | rewarded | **Primary income profile** — GREEN-only, ROI-ranked, Algora enrich |
| `rewarded-explore` | rewarded | YELLOW allowed when cash-in yields zero GREEN |
| `rewarded-hunt` | rewarded | Broad hunt with strict GREEN gates |
| `rewarded-hunt-dev` | rewarded | Fast local iteration (15-candidate cap) |
| `rewarded-trusted-only` | rewarded | Curated seed programs only |
| `rewarded-typescript` | rewarded | TypeScript bounty/reward/sponsor labels + rewarded-programs seeds, 5 broad queries (0.2.0 legacy) |
| `rewarded-verified-only` | rewarded | TypeScript, verified reward required, shortlist GREEN+YELLOW |
| `beginner-python-ts` | beginner | Learning path — deprioritize for income |
| `beginner-docs-only` | beginner | docs-friendly repos |
| `beginner-small-repos` | beginner | explicit `stars:<500` filter |

When a profile sets `repo_size_filter` (e.g. `stars:<500`), Scout applies it to trusted seed-list queries and broad label/language queries.

## Performance (0.3.0+)

- Disk cache: `.scout/cache/github/` with ETag support
- Bounded concurrency: `SCOUT_GITHUB_CONCURRENCY` (default 4)
- GraphQL batch enrichment: `SCOUT_ENRICH_MODE=auto|rest|graphql`
- Search pacing: `SCOUT_SEARCH_PACE_MS`, profile `search_pace_ms` on rewarded presets

Benchmark: `node scripts/benchmark-rewarded-hunt.mjs --lane nocache`

## Monitor

```powershell
node src/scout/cli.js monitor --profile rewarded-cash-in --skip-known --notify
pwsh ./scripts/monitor.ps1
```

Exit code **1** when new or improved candidates appear (for schedulers).

## Use Scout Efficiently

1. Run `rewarded-cash-in` with `full` preset before any coding-agent session
2. Read `handoff_package.json` and verify payout on platform manually
3. Track claims with `scout claims add/update`
4. Schedule daily monitor + weekly benchmark via `scripts/income-ops.ps1`

## CI

```powershell
npm run ci
```

GitHub Actions (self-hosted only): [`.github/workflows/ci-selfhosted.yml`](.github/workflows/ci-selfhosted.yml)

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for branch/PR and runner setup.

## Deferred

- OpenClaw/Slack native monitor notifications (webhook wrapper in monitoring runbook)
- Native `SCOUT_WEBHOOK_URL` consumption in Scout CLI
