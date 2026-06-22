# Report Review Runbook

## Harness
This runbook is agent-agnostic. Use it from Cursor, Claude Code, Gemini, Antigravity, Codex, or any harness that can invoke the Scout CLI and read local artifacts.

## Purpose
Validate Scout output, explain verdicts, and produce human-ready shortlists without changing issue state.

## Expected Scout CLI backend calls
- `scout validate-report --report <report.json>`
- `scout explain --candidate-id <id> --report <report.json>`
- `scout export-shortlist --report <report.json> --limit 25 --out scout_shortlist.md`
- `scout cockpit --report <report.json>`

## Workflow
1. Validate the report schema and decision coverage.
2. Explain verdicts for shortlisted candidates.
3. Export shortlist markdown for human review.
4. Before agent handoff, read `handoff_package.json` and confirm `handoff_mode` is `static_verified` or plan explicit static follow-up when `metadata_only` (check `handoff_mode_reason`).

## Rewarded intent notes
- Review Reward Signal and Income Summary columns in shortlists and reports.
- Scout does not verify payout amounts or platform terms.
