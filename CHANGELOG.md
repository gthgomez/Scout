# Changelog

## [0.2.0] — Release 3 (R3)

### R3.0 — Dual discovery intents + agent-agnostic harness
- Added `discovery_intent` (`beginner` | `rewarded`) on search profiles with backward-compatible default `beginner`
- Presets: `beginner-python-ts`, `rewarded-typescript`
- Reward signal extraction from GitHub labels/title/body (`extractRewardSignals`)
- `rewarded-programs` packaged seed list
- Intent-aware triage with `REWARD_GAP`, `income_summary`, and rewarded scoring
- Intent-specific report/shortlist columns
- Decision cockpit `reward_signal` confidence category
- Agent-agnostic rebrand: `agent_summary.md` primary, `codex_summary.md` compat copy
- Runbooks renamed to `*-runbook.md` with harness headers

### R3A — CLI wiring
- `scout cockpit --report`
- `scout plan install-dry-run` and `scout plan network-design`
- `decision-cockpit-runbook.md`

### R3B — Executable install probes
- `registry_allowlist` network policy in `probe.js`
- `install_probe` command set with R2D approval phrase validation
- Egress logging via `createEgressLogRecord` / `evaluateEgressHost`
- Adversarial tests for egress escape and lifecycle bypass

### R3C — Test probe gating
- `test_probe` requires successful `install_probe` evidence

### R3D — Handoff export
- `scout handoff` and `handoff_package.json` in workflow output
- Includes `discovery_intent` and rewarded payout disclaimer

---

## [0.1.0] — Release 2

### R2A–R2G
- Search profiles, discovery, static inspection, triage, reports
- R2D network design helpers, R2E install dry-run, R2F test design gate, R2G decision cockpit helpers
- Docker readonly probes, policy engine, monitor

### R2H
- Adversarial eval suite (33+ tests)

---

## [0.0.1] — Release 1

- Initial metadata-only Scout CLI
