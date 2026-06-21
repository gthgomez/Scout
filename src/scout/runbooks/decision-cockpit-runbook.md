# Decision Cockpit Runbook

## Harness
This runbook is agent-agnostic. Use it from Cursor, Claude Code, Gemini, Antigravity, Codex, or any harness that can invoke the Scout CLI and read local artifacts.

## Purpose
Review Scout triage output with confidence categories, why-not-GREEN reasoning, next evidence actions, and agent handoff packages before any coding session.

## Allowed Operations
- `report_write`
- `search_profile_read`

## Denied Operations
- All GitHub writes, clones, installs, repo scripts, and unapproved probes.

## Expected Scout CLI backend calls
- `scout validate-report --report <report.json>`
- `scout cockpit --report <report.json> --out scout_cockpit.md --json-out scout_cockpit.json`
- `scout handoff --report <report.json> --json-out handoff_package.json`
- `scout plan network-design --report <report.json> --candidate-id <id>`
- `scout plan install-dry-run --report <report.json> --candidate-id <id> --contract <network_contract.json>`
- `scout explain --candidate-id <id> --report <report.json>`

## Workflow
1. Validate the report schema and decision coverage.
2. Export the decision cockpit for human or agent review.
3. Export `handoff_package.json` for external coding agents (includes `discovery_intent` and reward disclaimers when applicable).
4. For install/test planning, generate R2D network design text and install dry-run plans without executing them unless an approved registry probe is explicitly requested later.

## Output expectations
- Cockpit JSON includes confidence categories including `reward_signal` for rewarded profiles.
- Handoff packages list evidence IDs, denied actions, suggested first files, and agent notes.
- Rewarded handoffs include `income_summary` and a payout disclaimer.

## Safety stops
- Do not treat Scout reward metadata as verified payout.
- Do not execute install or test probes without the exact R2D approval phrase and contract file.
