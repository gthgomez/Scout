# Codex Report Review Agent Runbook

## Purpose
Validate Scout output, explain verdicts, and produce human-ready shortlists without changing issue state or interacting with repository remotes.

## Allowed Operations
- `report_write`
- `search_profile_read`
- `search_profile_write`

## Denied Operations
- `git_clone`
- `recursive_submodule_fetch`
- `package_install`
- `shell_command`
- `repo_script_execution`
- `docker_build`
- `docker_run`
- `github_comment`
- `github_fork`
- `github_branch_create`
- `github_push`
- `github_pr_open`
- `github_write_action`

## Expected Scout CLI backend calls
Use `scout --help` for the top-level command list. Subcommands do not provide separate `--help` output.

- `scout workflow run --profile <profile-id> --out-dir <dir>`
  - preferred end-to-end safe recommendation workflow for Codex
- `scout validate-report --report <report-path>`
  - reads report model and audit entries, then returns validation pass/fail + violation summary
  - fails when candidates lack matching triage decisions
- `scout explain --candidate-id <candidate_id> --report <report-path>`
  - resolves verdict rationale, gap codes, risk summary, and `human_next_action`
- `scout export-shortlist --report <report-path> --limit <n> --out <path>`
  - emits condensed markdown list ordered by verdict/score
- `scout run --safe --limit <n> --out <path>`
  - optional re-run to refresh evidence before final handoff

## Output expectations
- Current artifacts are Markdown reports (`scout_report.md` style), shortlist Markdown (`scout_shortlist.md`), explain Markdown emitted to stdout, and JSON report models supplied through `--report`.
- JSON report fields include `run_status`, `collection_errors`, `candidates`, `evidence`, `decisions`, `audit_events`, `monitor_events`, `command_attempts`, and optional `sandbox_runs`, `probe_config`, and `probe_status`.
- Markdown verdict tables preserve `GREEN / YELLOW / GRAY / RED`, rank, scores, setup status, risk summary, next action, and evidence IDs for recommended candidates.
- Dropped candidate tables preserve `drop_reason` when present.
- `explain` output includes evidence IDs for risk claims and marks each claim `OBSERVED`, `INFERRED`, `PROPOSED`, or `UNKNOWN`.
- Must explicitly state setup caveats and unknowns instead of implying GitHub write capability or claim ownership.
- Must preserve `run_status`, `collection_errors`, and `static_inspection_status` in user summaries.
- Must not summarize `GREEN` candidates as setup-safe unless `setup_status` is `static_docs_ok`; candidates without setup guidance remain at most `YELLOW`.

## Safety stops
- Do not claim, comment, or open issues/PRs from this report process.
- Treat `manual_claim_possible` in `next_actions.json` as a human-only action, not authorization to post.
- Do not infer maintainer approvals, ownership rights, or repo trust beyond evidence.
- Do not call `scout probe` from report review; if a user approves a dynamic probe, hand off to the Dynamic Probe Agent runbook and revalidate the resulting probe report.
- Re-run validation if `search_profile` or policy version changes.
- If report references unsupported fields or inconsistent candidate IDs, fail closed and stop.
