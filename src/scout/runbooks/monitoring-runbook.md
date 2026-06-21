# Monitoring Runbook

## Harness
This runbook is agent-agnostic. Use it from Cursor, Claude Code, Gemini, Antigravity, Codex, or any harness that can invoke the Scout CLI and read local artifacts.

## Purpose
Re-run saved candidate profiles on a schedule and report meaningful changes across candidate quality and state over time.

## Expected Scout CLI backend calls
- `scout monitor --profile <profile-id> --out scout_watch_report.md --json-out scout_watch_report.json`
- `scout profile run <profile-id> --out scout_report.md`

## Notes
- Profiles retain `discovery_intent`; beginner and rewarded monitors use the same pipeline with intent-aware triage.
