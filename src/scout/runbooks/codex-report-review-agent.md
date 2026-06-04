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
- `scout validate-report <report-path>`
  - reads report model and audit entries, then returns validation pass/fail + violation summary
- `scout explain --candidate-id <candidate_id> --report <report-path>`
  - resolves verdict rationale, gap codes, risk summary, and `human_next_action`
- `scout export-shortlist --report <report-path> --limit <n> --out <path>`
  - emits condensed markdown list ordered by verdict/score
- `scout run --safe --limit <n> --out <path>`
  - optional re-run to refresh evidence before final handoff

## Output expectations
- Produce one final artifact per invocation:
  - validated report (`scout_report.md` style) or shortlist (`scout_shortlist.md`)
- Verdict tables should preserve:
  - `GREEN / YELLOW / GRAY / RED` with rank and scores
  - `drop_reason` when present, never omitted for dropped candidates
- `explain` outputs should include:
  - evidence IDs for every risk claim
  - whether each claim is `OBSERVED`, `INFERRED`, `PROPOSED`, or `UNKNOWN`
- Must explicitly state setup caveats and unknowns instead of implying GitHub write capability or claim ownership.

## Safety stops
- Do not claim, comment, or open issues/PRs from this report process.
- Do not infer maintainer approvals, ownership rights, or repo trust beyond evidence.
- Re-run validation if `search_profile` or policy version changes.
- If report references unsupported fields or inconsistent candidate IDs, fail closed and stop.
