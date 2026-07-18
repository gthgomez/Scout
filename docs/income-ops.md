# Income ops loop — Scout rewarded cash-in

Primary income workflow for Scout OSS coding bounties. Run manually or schedule via Windows Task Scheduler.

**Architecture:** funnel stages, package boundaries, and success metrics are defined in [`docs/architecture/income-funnel.md`](architecture/income-funnel.md).  
**Execution checklist:** [`docs/architecture/INCOME_FUNNEL_PHASE_CHECKLIST.md`](architecture/INCOME_FUNNEL_PHASE_CHECKLIST.md).

## Claim status vocabulary (canonical)

```text
researching → claimed → pr_open → merged → paid
                 ↘ abandoned
```

| Status | Meaning | Monitor skip? |
|--------|---------|---------------|
| `researching` | Human gate / reading | No |
| `claimed` | Working the bounty | Yes |
| `pr_open` | PR opened | Yes |
| `merged` | Merged, awaiting payout | Yes |
| `paid` | Cash received | Yes |
| `abandoned` | Dropped | No |

**Aliases** (accepted on `scout claims add|update --status`):

| Alias | Canonical |
|-------|-----------|
| `in_progress`, `working` | `claimed` |
| `submitted`, `pr` | `pr_open` |
| `done` | `paid` |
| `dropped` | `abandoned` |

## Daily (cached monitor)

Detects new/improved candidates on `rewarded-cash-in` without full rediscovery cost.

```powershell
pwsh -File .\scripts\income-ops.ps1 -Mode daily
```

Equivalent:

```powershell
node src/scout/cli.js monitor --profile rewarded-cash-in --skip-known --notify --out scout_watch_report.md --json-out scout_watch_report.json
```

- Exit code **1** = actionable new/improved candidates.
- On exit 1:
  - Posts rich webhook payload when `SCOUT_WEBHOOK_URL` is set (top candidate id, ROI, issue/platform URLs).
  - Runs `act-top1` dry-run and writes `.scout/act-top1.json`.

### Act on top pick

```powershell
# Dry-run: print top GREEN/YELLOW + write .scout/act-top1.json
pwsh -File .\scripts\income-ops.ps1 -Mode act

# Execute full workflow for cash-in packaging
pwsh -File .\scripts\income-ops.ps1 -Mode act -ExecuteAct
```

Or:

```powershell
node scripts/act-top1.mjs --report scout_watch_report.json --dry-run
node scripts/act-top1.mjs --report scout_watch_report.json --execute --out-dir scout_session_act
```

## Weekly (nocache benchmark + scorecard)

```powershell
pwsh -File .\scripts\income-ops.ps1 -Mode weekly
```

Runs:

1. `benchmark-rewarded-hunt.mjs --lane nocache`
2. `audit-seed-queries.mjs`
3. `income-scorecard.mjs` → `.scout/income-scorecard.md` + `.json`

Scorecard only:

```powershell
pwsh -File .\scripts\income-ops.ps1 -Mode scorecard
node scripts/income-scorecard.mjs
```

### Reliability targets (`.scout/benchmark-rewarded-hunt.json`)

| Metric | Target |
|--------|--------|
| `collection_error_403_rate` | `0` (≤0.1 acceptable while tuning) |
| `max_spam_farm_green` | `0` |
| `min_green_from_trusted_or_platform_pct` | `0.8` |
| `candidates_with_platform_url` | `≥1` |
| query count (cash-in profile) | `≤25` |

### Income KPIs (claims scorecard)

| Metric | Target (30 days) |
|--------|------------------|
| Paid bounties | ≥1 |
| In-flight claims | tracked weekly |
| GO decisions from act-top1 | ≥2 |

## Claims ledger

```powershell
node src/scout/cli.js claims add --issue-url https://github.com/org/repo/issues/42 --candidate-id SCOUT-org-repo-42 --status researching
node src/scout/cli.js claims update --issue-url https://github.com/org/repo/issues/42 --status claimed --note "handoff started"
node src/scout/cli.js claims update --issue-url https://github.com/org/repo/issues/42 --status pr_open --pr-url https://github.com/org/repo/pull/99
node src/scout/cli.js claims update --issue-url https://github.com/org/repo/issues/42 --status paid --amount-usd 150
node src/scout/cli.js claims list
node src/scout/cli.js claims stats
```

Aliases work: `--status in_progress` → `claimed`, `--status submitted` → `pr_open`.

Monitor `--skip-known` skips `claimed`, `pr_open`, `merged`, `paid`.

## Human gate after GREEN handoff

```powershell
node src/scout/cli.js workflow run --profile rewarded-cash-in --workflow-preset full --out-dir scout_session
```

1. Read `handoff_package.json` first.
2. Verify payout on platform before coding (Scout never sets `payout_verified_externally: true`).
3. Update claims ledger through the funnel.
4. Coding agent implements from handoff only.

If cash-in returns zero GREEN for a week, once:

```powershell
node src/scout/cli.js workflow run --profile rewarded-explore --workflow-preset full --out-dir scout_session_explore
```

## Yield notes (`rewarded-cash-in` 0.6.2+)

- Platform-first broad queries (Algora/IssueHunt before generic `label:bounty`).
- Seed body dual-queries **off** for cash-in (label seeds only) to keep search budget ≤25.
- Seeds pruned: high-signal Algora programs + lean general list; `unkeydev/unkey` excluded (422).
- Prefer quiet 30–60 min after failed 403 runs before weekly nocache.

## Scheduler examples

```powershell
# Daily 09:00 monitor
schtasks /Create /TN "ScoutIncomeDaily" /TR "pwsh -File C:\Workspace\Project_AI\Scout\scripts\income-ops.ps1 -Mode daily" /SC DAILY /ST 09:00

# Weekly Sunday 10:00 benchmark + scorecard
schtasks /Create /TN "ScoutIncomeWeekly" /TR "pwsh -File C:\Workspace\Project_AI\Scout\scripts\income-ops.ps1 -Mode weekly" /SC WEEKLY /D SUN /ST 10:00
```

Optional: set `SCOUT_WEBHOOK_URL` for Discord/Slack-compatible JSON posts on daily exit 1.
