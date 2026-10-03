# AGENTS.md — Scout

This file is the repository's sole instruction authority: model/vendor
instruction files (`CLAUDE.md`, `GEMINI.md`, `CODEX.md`) and nested
instruction files are prohibited in this repository. The workspace-root
`ENGINEERING.md` and `AGENTS.md` remain authoritative for safety.

Policy gates **Scout CLI operations** (runbook allow/deny lists). Harnesses
must enforce the same boundaries when acting outside Scout.

## Start Here

1. Read [`docs/agent/PROJECT_CONTEXT.md`](docs/agent/PROJECT_CONTEXT.md) for the CLI surface and policy boundaries.
2. For coding handoffs, **start from `handoff_package.json`** in the session output directory — do not re-run discovery unless `run_status=failed`. Check `handoff_mode`: `static_verified` means at least one shortlist candidate has archive-backed static evidence; `metadata_only` (read `handoff_mode_reason`) needs explicit static follow-up before coding even if full preset ran.
3. Read [`docs/agent/AGENT_HANDOFF.md`](docs/agent/AGENT_HANDOFF.md) for the session-artifact reading order and the handoff contract (schemas 1.1 / 1.2).
4. Use runbooks under [`src/scout/runbooks/`](src/scout/runbooks/README.md) for stage-specific allowed/denied operations.

## Denied Regardless of Harness

- Unapproved `git clone`, package install, repo scripts, GitHub writes
- Running `scout probe` without approval contract from discovery/static roles
- Re-discovering when a valid session report already exists

## Verification

```powershell
npm run ci
```
