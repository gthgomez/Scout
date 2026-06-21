# Scout

Scout is a policy-enforced, agent-agnostic local tool for finding open-source contribution candidates. Any AI agent harness (Cursor, Claude Code, Gemini, Antigravity, Codex, and others) can orchestrate Scout via runbooks and CLI artifacts.

Release 3 adds dual discovery intents:

- **Beginner** — learning-focused issues with setup clarity and small scope.
- **Rewarded** — bounty/reward metadata hunts using GitHub labels, titles, bodies, and curated seed lists.

Release 1–2 scope remains the evidence pipeline core:

- GitHub metadata discovery and enrichment
- Saved search profiles with seed lists and threshold overrides
- Intent-aware triage and portfolio scoring
- Evidence-backed Markdown/JSON reports
- Static inspection and approval-bound Docker probes
- Policy denials before unsafe operations

## Agent Runbooks

- [Discovery](src/scout/runbooks/discovery-runbook.md)
- [Static Inspection](src/scout/runbooks/static-inspection-runbook.md)
- [Dynamic Probe](src/scout/runbooks/dynamic-probe-runbook.md)
- [Report Review](src/scout/runbooks/report-review-runbook.md)
- [Decision Cockpit](src/scout/runbooks/decision-cockpit-runbook.md)
- [Monitoring](src/scout/runbooks/monitoring-runbook.md)

Legacy `codex-*-agent.md` stubs redirect to the renamed runbooks.

## Agent Workflow

```powershell
npm test
node src/scout/cli.js profile create beginner-python-ts --intent beginner
node src/scout/cli.js workflow run --profile beginner-python-ts --out-dir scout_session
node src/scout/cli.js profile create rewarded-typescript --intent rewarded --trusted-seed-lists rewarded-programs
node src/scout/cli.js workflow run --profile rewarded-typescript --out-dir scout_reward_session
node src/scout/cli.js cockpit --report scout_reward_session/scout_report.json
node src/scout/cli.js handoff --report scout_reward_session/scout_report.json --json-out handoff_package.json
```

`workflow run` writes `agent_summary.md` (primary), deprecated `codex_summary.md` (identical compat copy), `handoff_package.json`, and the standard report artifacts.

## Discovery Intents

| Preset | Intent | Seed list | Notes |
| --- | --- | --- | --- |
| `beginner-python-ts` | `beginner` | `default` | good first issue / help wanted / docs |
| `rewarded-typescript` | `rewarded` | `rewarded-programs` | bounty/reward label and title queries |

Profiles without `discovery_intent` default to `beginner`.

## Release 3 Probe Extensions

- `registry_allowlist` network policy with R2D approval phrase validation
- Executable `install_probe` and `test_probe` command sets (pre-command egress logging)
- `test_probe` gated on successful `install_probe` evidence
- `scout plan install-dry-run` and `scout plan network-design` CLI wiring

Readonly `--network none --command-set readonly` probes remain the default safe path.

**Egress honesty:** `registry_allowlist` probes infer registry hostnames from planned argv and block commands whose inferred host is outside the approved list. Docker sandboxes use bridge networking; Scout does not enforce packet-level egress filtering or monitor runtime traffic.

## Policy Boundary

Scout still denies unapproved clones, installs, repo scripts, GitHub writes, issue claiming, and coding workflows regardless of harness.
