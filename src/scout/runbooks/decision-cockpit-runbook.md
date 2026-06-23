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
3. Export `handoff_package.json` — schema **1.2** when `discovery_intent` is `rewarded`, otherwise **1.1**. Start here for external coding agents. Read `recommended_packages`, `handoff_mode`, `workflow_preset`, and `suggested_commands` first. JSON Schema: [`schemas/handoff-package-1.2.json`](../../../schemas/handoff-package-1.2.json) (rewarded) or [`schemas/handoff-package-1.1.json`](../../../schemas/handoff-package-1.1.json) (beginner).
4. Check `handoff_mode` before handoff: `static_verified` only when archive fetch ran and at least one shortlist candidate has non-low `static_evidence` confidence; otherwise `metadata_only` (see `handoff_mode_reason`).
5. Review cockpit confidence categories — especially `static_evidence` — before recommending any package for coding-agent handoff.
6. For install/test planning, generate R2D network design text and install dry-run plans without executing them unless an approved registry probe is explicitly requested later.

## Output expectations
- Cockpit JSON includes confidence categories including `reward_signal` for rewarded profiles.
- Cockpit markdown may show a **metadata-only handoff warning** when `handoff_mode` is `metadata_only` (fast preset, or full preset with failed/insufficient archive fetch).
- Handoff packages list evidence IDs, denied actions, suggested first files, and agent notes.
- Rewarded handoffs (schema 1.2) include `platform_claim_url`, `platform_name`, `claim_steps`, `suggested_branch_name`, `roi_score`, `estimated_effort_hours`, and `payout_verified_externally: false` on each entry.
- Cockpit rows for rewarded sessions show `roi_score`, `estimated_effort_hours`, and `claim_friction_score`.
- `handoff_mode` reflects evidence outcomes, not workflow intent; `workflow_preset` records which preset ran.
- Rewarded handoffs include `income_summary` and a payout disclaimer.

## Safety stops
- Do not treat Scout reward metadata as verified payout.
- Do not execute install or test probes without the exact R2D approval phrase and contract file.
