# Scout Project Context

## What Scout Is

Scout is a policy-enforced backend for finding open-source contribution candidates. It is orchestrated by AI agent harnesses through runbooks and CLI artifacts — not tied to a single vendor runtime.

## Discovery Intents

Scout separates **policy mode** (`metadata_only`, `static_inspection`, `dynamic_probe`) from **discovery intent** (`beginner`, `rewarded`).

| Intent | Mission | Built-in preset |
| --- | --- | --- |
| `beginner` | Learning-focused contributions, setup clarity, small scope | `beginner-python-ts` |
| `rewarded` | Income/bounty metadata from GitHub labels/titles/bodies + seed lists | `rewarded-typescript` |

Profiles missing `discovery_intent` validate as `beginner`.

## Agent Artifact Contract

`scout workflow run --out-dir <dir>` writes:

- `scout_session.json` — profile snapshot
- `scout_report.md` / `scout_report.json` — full evidence model
- `scout_shortlist.md` — ranked shortlist
- `agent_summary.md` — primary harness summary
- `codex_summary.md` — deprecated identical compat copy (one release)
- `handoff_package.json` — external coding-agent handoff (`discovery_intent`, evidence IDs, denied actions)
- `next_actions.json` — per-candidate recommended actions

## Supported Harness Examples

Cursor, Claude Code, Gemini CLI, Antigravity, Codex, or any tool that can:

1. Run `node src/scout/cli.js` commands locally
2. Read Markdown/JSON artifacts from an output directory
3. Respect Scout policy denials in runbooks

This list is illustrative, not exhaustive.

## Policy Boundary

Regardless of harness:

- No unapproved `git clone`, package install, repo script execution, or GitHub writes
- Reward metadata is inferred from GitHub only; Scout does not verify payout
- Registry install/test probes require R2D approval phrases and pre-command egress logging
- Docker `registry_allowlist` probes use bridge networking; Scout does not enforce packet-level egress filtering

## Key CLI Additions (R3)

- `scout profile create <name> --intent beginner|rewarded`
- `scout cockpit --report <json>`
- `scout plan install-dry-run --report <json> --candidate-id <id> --contract <json>`
- `scout plan network-design --report <json> --candidate-id <id>`
- `scout handoff --report <json> --json-out handoff_package.json`

## Repository Layout

- `src/scout/cli.js` — CLI entry
- `src/scout/profiles.js` — profiles and presets
- `src/scout/discovery.js` — GitHub discovery + reward signals
- `src/scout/triage.js` — intent-aware triage
- `src/scout/runbooks/` — agent-agnostic runbooks
