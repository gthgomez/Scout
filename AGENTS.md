# AGENTS.md — Scout

Agent-neutral routing for Scout. Root workspace `ENGINEERING.md` and `AGENTS.md` remain authoritative for safety.

## Start Here

1. Read [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) for CLI surface and policy boundaries.
2. For coding handoffs, **start from `handoff_package.json`** in the session output directory — do not re-run discovery unless `run_status=failed`.
3. Use runbooks under [`src/scout/runbooks/`](src/scout/runbooks/) for stage-specific allowed/denied operations.

## Handoff Contract (schema 1.1)

`handoff_package.json` is the primary agent entrypoint:

- `schema_version`: `"1.1"`
- `recommended_packages`: top-ranked GREEN/YELLOW candidate IDs
- `suggested_commands`: read-only CLI follow-ups (e.g. `scout explain`)
- `packages[]`: per-candidate evidence IDs, denied actions, and agent notes

Do not treat reward metadata as verified payout.

## Preferred Workflow

```powershell
npm run ci
node src/scout/cli.js workflow run --profile beginner-python-ts --out-dir scout_session --through discover,cockpit,handoff
```

Resume incomplete sessions:

```powershell
node src/scout/cli.js workflow resume --session scout_session
```

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
