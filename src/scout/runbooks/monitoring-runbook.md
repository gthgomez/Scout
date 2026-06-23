# Monitoring Runbook

## Harness
This runbook is agent-agnostic. Use it from Cursor, Claude Code, Gemini, Antigravity, Codex, or any harness that can invoke the Scout CLI and read local artifacts.

## Purpose
Re-run saved candidate profiles on a schedule and report meaningful changes across candidate quality and state over time.

## Expected Scout CLI backend calls
- `scout monitor --profile <profile-id> --skip-known --notify --out scout_watch_report.md --json-out scout_watch_report.json`
- `scout monitor --profile <profile-id> --since <iso8601> --out scout_watch_report.md`
- `scout profile run <profile-id> --out scout_report.md`

## Notes
- `--skip-known` reuses unchanged candidates from the last snapshot (fewer GitHub API calls).
- `--notify` is a **stdout hook only** — prints one line such as `SCOUT_MONITOR profile=... new=N improved=N ...` for schedulers. Scout does not send webhooks, Slack, or OpenClaw messages directly (native integration deferred).
- Exit code **1** when new or improved candidates appear.
- Example scheduler script: `scripts/monitor.ps1` (Windows Task Scheduler).
- Webhook example wrapper (run after monitor, on exit code 1):

```powershell
node src/scout/cli.js monitor --profile beginner-python-ts --skip-known --notify
if ($LASTEXITCODE -eq 1) {
  Invoke-RestMethod -Method Post -Uri $env:SCOUT_WEBHOOK_URL -Body '{"source":"scout-monitor"}'
}
```

- Profiles retain `discovery_intent`; beginner and rewarded monitors use the same pipeline with intent-aware triage.
- **Rewarded cash-in workflow (default):** use profile `rewarded-cash-in` for GREEN-only shortlists that require trusted seed or platform URL.
- **Daily cached monitor:** `scout monitor --profile rewarded-cash-in --skip-known --notify --out scout_watch_report.md --json-out scout_watch_report.json`
- **Weekly nocache audit:** `node scripts/benchmark-rewarded-hunt.mjs --lane nocache` — verify precision targets (`max_spam_farm_green: 0`, `min_green_from_trusted_or_platform_pct: 0.8`).
- **Local iteration:** `scout profile run rewarded-hunt-dev --limit 15` (cached runs omit `--no-cache`).
- Follow-up on actionable events: `scout workflow run --profile rewarded-cash-in --workflow-preset fast` for cockpit/handoff refresh with schema 1.2 claim steps.
