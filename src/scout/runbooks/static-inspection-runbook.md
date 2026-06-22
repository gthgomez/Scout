# Static Inspection Runbook

## Harness
This runbook is agent-agnostic. Use it from Cursor, Claude Code, Gemini, Antigravity, Codex, or any harness that can invoke the Scout CLI and read local artifacts.

## Purpose
Collect static, read-only repository evidence to confirm setup feasibility and reduce false `GREEN` signals before handoff to a human coder or downstream probe planning.

Moved from the former `codex-static-inspection-agent.md`. See that stub for the prior filename.

## Allowed Operations
- `github_issue_metadata_read`
- `github_repo_metadata_read`
- `static_source_fetch`
- `archive_download`
- `static_file_read`
- `search_profile_read`
- `search_profile_write`
- `report_write`

## Denied Operations
- `git_clone`
- `package_install`
- `shell_command`
- `repo_script_execution`
- `docker_run`
- GitHub write operations

## Expected Scout CLI backend calls
- `scout inspect --report <report.json> --manifest <manifest.json>`
- `scout inspect --report <report.json> --fetch-archives`
- `scout validate-report --report <updated-report.json>`
- `scout workflow run --workflow-preset full` — runs static archive fetch automatically for the workflow shortlist (no separate static stage needed when using full preset)

## Workflow note
`scout workflow run --workflow-preset full` includes the static stage with shortlist-scoped archive fetch before cockpit and handoff. If archive fetch fails for all shortlist candidates, handoff remains `metadata_only` despite the full preset.

## Safety stops
- Never execute README install commands.
- Archive inspection must respect Scout static allowlists and cleanup temp workspaces.
