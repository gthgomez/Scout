# Scout architecture

Doc index: [`../README.md`](../README.md). ADRs: [`income-funnel.md`](income-funnel.md) (+ [phase checklist](INCOME_FUNNEL_PHASE_CHECKLIST.md)). Research: [`../research/README.md`](../research/README.md).

## Overview

Scout is a policy-enforced Node.js CLI (ESM, zero runtime deps) that discovers paid-bounty candidates via GitHub search, triages them (GREEN/YELLOW/RED/GRAY), optionally runs static archive inspection and Docker probes, and exports a validated handoff package for external AI coding agents. No clone/install/write operations are permitted by policy: Scout reads remote metadata and source archives, and writes only its own session artifacts.

## Module map

### Entry

- `cli.js` — subcommand dispatch, .env loader, workflow/monitor orchestration

### Ingest

- `discovery.js` — discovery orchestrator
- `discovery-query.js` — query classification / budgets
- `github-client.js` — REST client, enrich modes, rate limits
- `github-graphql.js` — chunked GraphQL enrichment
- `github-cache.js` — disk cache with TTL
- `github-rate-limit.js` — header parsing
- `github-search-policy.js` — pacing / retry / cooldown
- `async-pool.js` — bounded concurrency
- `candidate-metadata.js` — issue/repo metadata
- `reward-signals.js` — USD/RTC/USDC/USDT extraction
- `bounty-spam.js` — spam heuristics
- `contributing-prefetch.js` — CONTRIBUTING.md prefetch
- `contributing-reward-scan.js` — CONTRIBUTING.md reward scan
- `algora-enrich.js` — Algora HTML scrape
- `algora-api-enrich.js` — Algora API enrichment
- `seed-lists.js` + `seed-lists/` — trusted seed data
- `profiles.js` — presets / query generation
- `types.js` — shared enums

### Filter / triage

- `triage.js` — verdicts, thresholds (GREEN/YELLOW/RED/GRAY)
- `roi-ranking.js` — ROI / effort / friction scoring

### Package

- `workflow.js` — stage executor
- `session.js` — presets, manifest, `WORKFLOW_STAGES`
- `report.js` — report model + markdown
- `decision-cockpit.js` — cockpit + handoff export, schema 1.1/1.2
- `static-inspection.js` — archive fetch / inspect
- `setup-intelligence.js` — docs analysis, injection heuristics
- `claim-steps.js` — per-platform claim templates

### Ops

- `monitor.js` — report diffing → events
- `claims-ledger.js` — claim lifecycle
- `income-ops.js` — act-top1 / scorecard / webhook
- `audit-log.js` — audit events

### Policy & safety

- `policy.js` — allow/deny matrix per mode
- `default-policy.yaml` — default policy data
- `validators.js` — runtime validators
- `probe.js` — Docker sandbox
- `install-probe-dry-run.js` — install contracts (dry-run only)
- `network-design.js` — egress contracts

## Pipeline narrative

**discover** — runs the profile's queries (broad, trusted-seed, platform) through `discovery.js`, enriches candidates with metadata + reward signals, then triages and ranks. Produces `scout_report.json` / `scout_report.md` (full candidate + verdict model) and `scout_shortlist.md` (top-N for review).

**static** — `full` preset only. Fetches shortlisted candidates' source archives (never clones) and inspects them via `static-inspection.js`; `setup-intelligence.js` analyzes docs and flags injection heuristics. Produces `scout_static_report.json` / `.md` and sets `handoff_mode: static_verified`.

**cockpit** — confidence drill-down per candidate (reason, evidence, effort/friction) over the ranked report, and the decision point for what reaches handoff. Produces `scout_cockpit.json`.

**handoff** — validates and exports the handoff package (schema 1.2 for `rewarded`, 1.1 for `beginner` — see [`../../schemas/README.md`](../../schemas/README.md)) plus a summary. `handoff_package.json` is the artifact external coding agents consume; routing contract in [`../../AGENTS.md`](../../AGENTS.md).

**Artifact flow** (per session, under the session out-dir):

```
scout_session.json        manifest (preset, stages, artifacts)
  → scout_report.json     discover — candidates, verdicts, rewards
  → scout_shortlist.md    shortlist for human/agent review
  → scout_cockpit.json    cockpit — confidence drill-down
  → handoff_package.json  handoff — validated, schema 1.1/1.2
  → agent_summary.md      handoff summary for coding agents
```

## Runtime data

| Location | Contents |
| --- | --- |
| `.scout/` | cache, claims ledger, act-top1, benchmarks, scorecards |
| `scout_session*/` | session output bundles (manifest + stage artifacts) |
| `reports/` | ad-hoc report dumps |

Env vars (GitHub token, concurrency, pacing, enrich mode, webhook): table in [`../../PROJECT_CONTEXT.md`](../../PROJECT_CONTEXT.md) (`## Environment`). Runbook safety contracts: [`../../src/scout/runbooks/README.md`](../../src/scout/runbooks/README.md).

**Safe extension points** — add a discovery profile in `profiles.js`; add a schema in `schemas/` + `validators.js`; add a stage in `session.js` (`WORKFLOW_STAGES`).
