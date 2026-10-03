# Scout agent handoff workflow

Ordinary project documentation — not an instruction file. Repository
instruction authority lives in the root [`AGENTS.md`](../../AGENTS.md); this
doc covers how an agent consumes a Scout session and hands off to coding.

## Session artifacts to read (in order)

1. `handoff_package.json` — primary entrypoint
2. `scout_session.json` — preset and stages completed
3. `scout_report.json` — full evidence and triage (schema: [`schemas/scout-report-1.0.json`](../../schemas/scout-report-1.0.json))
4. `agent_summary.md` — concise human/agent summary
5. `scout_cockpit.json` — optional confidence drill-down

## Handoff Contract (schema 1.1 / 1.2)

`handoff_package.json` is the primary agent entrypoint:

- `schema_version`: `"1.1"` (beginner discovery) or `"1.2"` (rewarded discovery — the income lane)
- `handoff_mode`: `"metadata_only"` | `"static_verified"` (outcome-based, not preset intent)
- `handoff_mode_reason`: set when `metadata_only` — explains skipped static or failed archive fetch
- `recommended_packages`: preset-filtered GREEN/YELLOW candidate IDs (never RED/GRAY)
- `suggested_commands`: read-only CLI follow-ups with session-relative `--report` paths and optional `cwd`
- `packages[]`: per-candidate evidence IDs, denied actions, and agent notes
- schema 1.2 entries add: `platform_claim_url`, `platform_name` (`algora`|`issuehunt`|`opire`|`unknown`), `claim_steps`, `suggested_branch_name`, `roi_score`, `estimated_effort_hours`, `acceptance_criteria_summary`, and `payout_verified_externally` (Scout NEVER exports this as `true`)

JSON Schemas: [`schemas/README.md`](../../schemas/README.md). Handoff exports validate by default; use `validateOnExport: false` only in tests.

Do not treat reward metadata as verified payout. `has_observed_reward_metadata` reflects GitHub label/title observations only.

## Preferred Workflow

```powershell
npm run ci
node src/scout/cli.js workflow run --profile rewarded-cash-in --workflow-preset full --out-dir scout_session
```

Beginner learning lane: `--profile beginner-python-ts`.

With token set, defaults to **full** preset. Explicit fast path:

```powershell
node src/scout/cli.js workflow run --profile beginner-python-ts --out-dir scout_session --workflow-preset fast
```

Resume incomplete sessions:

```powershell
node src/scout/cli.js workflow resume --session scout_session
```

## Workflow Presets

| Preset | Stages | When |
| --- | --- | --- |
| `fast` | discover, cockpit, handoff | Quick scan, no token, monitor follow-up |
| `full` | discover, static, cockpit, handoff | Before coding-agent handoff |
