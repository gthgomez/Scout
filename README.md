# Scout

Scout is a policy-enforced, agent-agnostic local tool for finding open-source contribution candidates. Any AI agent harness (Cursor, Claude Code, Gemini, Antigravity, Codex, and others) can orchestrate Scout via runbooks and CLI artifacts.

**Current release: 0.3.2** — performance (cache, GraphQL enrichment), workflow pipeline, and incremental monitor.

## Prerequisites

- **Node.js 20+**
- **GitHub token**: copy `.env.example` to `.env` and set `GITHUB_TOKEN` (or `GH_TOKEN`)
- **Docker** (optional): for `scout probe` only — `docker build -t scout-sandbox:latest .`

## Agent Runbooks

- [Discovery](src/scout/runbooks/discovery-runbook.md)
- [Static Inspection](src/scout/runbooks/static-inspection-runbook.md)
- [Dynamic Probe](src/scout/runbooks/dynamic-probe-runbook.md)
- [Report Review](src/scout/runbooks/report-review-runbook.md)
- [Decision Cockpit](src/scout/runbooks/decision-cockpit-runbook.md)
- [Monitoring](src/scout/runbooks/monitoring-runbook.md)

Harness routing: [`AGENTS.md`](AGENTS.md) — **start from `handoff_package.json`**.

## Quick Workflow

```powershell
npm run ci
node src/scout/cli.js workflow run --profile beginner-python-ts --out-dir scout_session --through discover,cockpit,handoff
node src/scout/cli.js workflow resume --session scout_session
```

## Discovery Presets

| Preset | Intent | Notes |
| --- | --- | --- |
| `beginner-python-ts` | beginner | mid-size seed list (`beginner-small`) |
| `beginner-docs-only` | beginner | docs-friendly repos |
| `beginner-small-repos` | beginner | `stars:<500` filter |
| `rewarded-typescript` | rewarded | bounty/reward queries |
| `rewarded-verified-only` | rewarded | verified reward signals only |

## Performance (0.3.0+)

- Disk cache: `.scout/cache/github/` with ETag support
- Bounded concurrency: `SCOUT_GITHUB_CONCURRENCY` (default 4)
- GraphQL batch enrichment: `SCOUT_ENRICH_MODE=auto|rest|graphql`
- CLI: `--no-cache`, `--enrich-mode auto`

Benchmark: `pwsh ./scripts/benchmark-discovery.ps1`

## Monitor (0.3.2)

```powershell
node src/scout/cli.js monitor --profile beginner-python-ts --skip-known --notify
pwsh ./scripts/monitor.ps1
```

Exit code **1** when new or improved candidates appear (for schedulers).

## Use Scout Efficiently

1. Start with small `--max-candidates` (15–20)
2. Run `--through discover,cockpit,handoff` in one step
3. Read `handoff_package.json` before any coding agent session
4. Schedule weekly `monitor --skip-known` instead of full rediscovery

## Local CI

```powershell
npm run ci
```

No GitHub Actions — see `.github/workflows/test.yml` (disabled reminder).

## Deferred

- `codex_summary.md` removal in 0.4.0
- OpenClaw/Slack monitor notifications
