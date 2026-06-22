# AGENTS.md — Scout

Agent-neutral routing for Scout. Root workspace `ENGINEERING.md` and `AGENTS.md` remain authoritative for safety.

Policy gates **Scout CLI operations** (runbook allow/deny lists). Harnesses must enforce the same boundaries when acting outside Scout.

## Start Here

1. Read [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) for CLI surface and policy boundaries.
2. For coding handoffs, **start from `handoff_package.json`** in the session output directory — do not re-run discovery unless `run_status=failed`.
3. Check `handoff_mode`: `static_verified` means at least one shortlist candidate has archive-backed static evidence; `metadata_only` (read `handoff_mode_reason`) needs explicit static follow-up before coding even if full preset ran.
4. Use runbooks under [`src/scout/runbooks/`](src/scout/runbooks/) for stage-specific allowed/denied operations.

## Handoff Contract (schema 1.1)

`handoff_package.json` is the primary agent entrypoint:

- `schema_version`: `"1.1"`
- `handoff_mode`: `"metadata_only"` | `"static_verified"` (outcome-based, not preset intent)
- `handoff_mode_reason`: set when `metadata_only` — explains skipped static or failed archive fetch
- `recommended_packages`: preset-filtered GREEN/YELLOW candidate IDs (never RED/GRAY)
- `suggested_commands`: read-only CLI follow-ups with session-relative `--report` paths
- `packages[]`: per-candidate evidence IDs, denied actions, and agent notes

Do not treat reward metadata as verified payout. `has_observed_reward_metadata` reflects GitHub label/title observations only.

## Preferred Workflow

```powershell
npm run ci
node src/scout/cli.js workflow run --profile beginner-python-ts --out-dir scout_session
```

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

## Denied Regardless of Harness

- Unapproved `git clone`, package install, repo scripts, GitHub writes
- Running `scout probe` without approval contract from discovery/static roles
- Re-discovering when a valid session report already exists

## Verification

```powershell
npm run ci
```

## Deprecated

- `codex_summary.md` — identical compat copy; removal planned in 0.4.0. Prefer `agent_summary.md`.
- `codex-*-agent.md` stubs — see [`src/scout/runbooks/README.md`](src/scout/runbooks/README.md).
