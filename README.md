# Scout

Scout is a policy-enforced, agent-agnostic local tool for finding open-source contribution candidates. Any AI agent harness (Cursor, Claude Code, Gemini, Antigravity, Codex, and others) can orchestrate Scout via runbooks and CLI artifacts.

Policy gates **Scout CLI operations** (allowed/denied commands per runbook role). Agent harnesses must follow runbooks; Scout does not enforce policy inside external coding agents.

**Current release: 0.3.3** — workflow presets (fast/full), archive-backed static stage, and handoff honesty.

## Prerequisites

- **Node.js 20+**
- **GitHub token**: copy `.env.example` to `.env` and set `GITHUB_TOKEN` (or `GH_TOKEN`) — required for `full` workflow preset (archive fetch)
- **Docker** (optional): for `scout probe` only — `docker build -t scout-sandbox:latest .`

## Agent Runbooks

See [`src/scout/runbooks/README.md`](src/scout/runbooks/README.md) for the full index.

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
node src/scout/cli.js workflow run --profile beginner-python-ts --out-dir scout_session
node src/scout/cli.js workflow resume --session scout_session
```

With `GITHUB_TOKEN` or `GH_TOKEN` set, `workflow run` defaults to **full** preset (archive-backed static inspection). Without a token, it defaults to **fast** (metadata-only handoff).

```powershell
node src/scout/cli.js workflow run --profile beginner-python-ts --out-dir scout_session --workflow-preset full --shortlist-limit 10
node src/scout/cli.js workflow run --profile beginner-python-ts --out-dir scout_fast --workflow-preset fast
```

## Workflow Presets

| Preset | `--through` | Static archives | Use when |
| --- | --- | --- | --- |
| `fast` | `discover,cockpit,handoff` | skipped | Quick scan, monitor follow-up, no token |
| `full` | `discover,static,cockpit,handoff` | shortlist archive fetch | Before coding-agent handoff |

Session manifest (`scout_session.json`) records `workflow_preset_requested`, `workflow_preset_effective`, and `static_fetch_archives`.

## Discovery Presets

| Preset | Intent | Notes |
| --- | --- | --- |
| `beginner-python-ts` | beginner | mid-size seed list with `stars:<500` filter |
| `beginner-docs-only` | beginner | docs-friendly repos |
| `beginner-small-repos` | beginner | explicit `stars:<500` filter |
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

Exit code **1** when new or improved candidates appear (for schedulers). `--notify` prints a stdout hook line for schedulers; wrap with your own webhook if needed (see monitoring runbook).

## Use Scout Efficiently

1. Start with small `--max-candidates` (15–20)
2. Use `workflow run` (token → full preset) before any coding-agent session
3. Read `handoff_package.json` and check `handoff_mode` (`metadata_only` vs `static_verified`)
4. Schedule weekly `monitor --skip-known` instead of full rediscovery

## CI

Canonical local verification:

```powershell
npm run ci
```

GitHub Actions (self-hosted only — no cloud runner minutes):

- [`.github/workflows/ci-selfhosted.yml`](.github/workflows/ci-selfhosted.yml) — local Windows runner (`self-hosted`, `windows`), runs `scripts/ci.ps1`

## Deferred

- `codex_summary.md` removal in 0.4.0
- JSON Schema for handoff/report artifacts in 0.4.0
- OpenClaw/Slack monitor notifications
