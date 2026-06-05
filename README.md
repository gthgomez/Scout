# Scout

Scout is a Codex-driven, policy-enforced local tool for finding beginner-realistic open-source contribution candidates.

Release 1 scope:

- GitHub metadata discovery.
- Saved search profiles.
- Metadata-only monitoring.
- Deterministic triage and portfolio scoring.
- Evidence-backed Markdown reports.
- Policy denials before unsafe operations.
- Manifest-based static inspection checks.

Current implementation status:

- Implemented: metadata discovery, profile create/run, trusted seed lists, threshold overrides, metadata monitoring, triage/ranking, report generation, report validation, explain, shortlist export, Codex workflow artifacts, static manifest inspection, and policy-gated GitHub zip archive inspection.
- Static inspection fetches GitHub zip archives in `static_inspection` mode, validates archive entries, extracts only allowlisted static files to a temp workspace, parses those files as data for setup/risk signals, and removes the temp workspace.
- Discovery records GitHub REST rate-limit headers when present, and static inspection flags prompt-injection text, private/paid services, hidden environment requirements, credential placeholders, lifecycle scripts, and conflicting package managers.
- Release 2 implemented: approval-bound Docker-backed readonly probes for one statically inspected candidate at a time, structured setup intelligence, denied command provenance, and Docker probe diagnostics.
- Not implemented: package installs, repo commands, repository-defined scripts, networked dependency probes, GitHub write actions, and issue-to-patch work.

Scout still denies:

- `git clone`
- package installs
- repo scripts
- shell commands from candidate repos
- repo Docker builds, Docker Compose, nested Docker, and Docker socket access
- GitHub comments, forks, pushes, branches, and PRs
- package-registry network, lifecycle scripts, repo tests, Docker Compose, and coding workflows

Primary UX is Codex orchestration. The CLI is the deterministic backend and test harness.

## Agent Runbooks

- [Discovery](src/scout/runbooks/codex-discovery-agent.md) - metadata-only search and shortlist handoff.
- [Static Inspection](src/scout/runbooks/codex-static-inspection-agent.md) - manifest or policy-gated archive inspection without execution.
- [Dynamic Probe](src/scout/runbooks/codex-dynamic-probe-agent.md) - human-approved no-network readonly Docker probes for statically inspected candidates.
- [Report Review](src/scout/runbooks/codex-report-review-agent.md) - validation, explain output, and shortlist export.
- [Monitoring](src/scout/runbooks/codex-monitoring-agent.md) - saved-profile reruns and monitor event review.

## CLI Help And Availability

Top-level help is available with `node src/scout/cli.js --help` or `node src/scout/cli.js help`. Individual subcommands do not expose separate `--help` output; use the top-level command list and runbooks for current syntax.

`probe` is available only for Release 2's narrow sandbox contract: one candidate from an existing static-inspection report, explicit `--approval-id`, `--network none`, and `--command-set readonly`. It does not install packages, run tests, execute repo scripts, start services, claim issues, or write to GitHub.

`probe doctor` checks whether the Docker CLI and local sandbox image are available. The Docker runner uses `--pull never`; if the image is missing, Scout fails closed instead of pulling from a registry.

## Codex Workflow

```powershell
npm test
node src/scout/cli.js profile create beginner-python --languages Python --labels "good first issue,help wanted" --exclude-orgs archived-org
node src/scout/cli.js workflow run --profile beginner-python --out-dir scout_session
node src/scout/cli.js monitor --profile beginner-python --out scout_watch_report.md --json-out scout_watch_report.json
node src/scout/cli.js inspect --report scout_watch_report.json --manifest manifest.json --out scout_static_report.md --json-out scout_static_report.json
node src/scout/cli.js inspect --report scout_watch_report.json --fetch-archives --out scout_static_report.md --json-out scout_static_report.json
node src/scout/cli.js validate-report --report scout_static_report.json
node src/scout/cli.js probe doctor --json-out scout_probe_doctor.json
node src/scout/cli.js probe --report scout_static_report.json --candidate-id SCOUT-0001 --approval-id APPROVAL-123 --network none --command-set readonly --out scout_probe_report.md --json-out scout_probe_report.json
node src/scout/cli.js export-shortlist --report scout_static_report.json --limit 25 --out scout_shortlist.md
```

`inspect` supports both an explicit `manifest.json` path for deterministic tests and `--fetch-archives` for policy-gated GitHub zip archive inspection.

Scout stores local profiles and monitor snapshots under `.scout/`. That directory is ignored by Git because it is runtime state, not source code.

Current outputs are Markdown reports or summaries plus JSON report models. The JSON report includes fields such as `run_status`, `collection_errors`, `candidates`, `evidence`, `decisions`, `audit_events`, `monitor_events`, `command_attempts`, `sandbox_runs`, `probe_config`, and `probe_status`. Monitoring also writes the latest profile snapshot to `.scout/monitor/<profile>.json`.

The Codex-facing workflow writes `scout_session.json`, `scout_report.md`, `scout_report.json`, `scout_shortlist.md`, `codex_summary.md`, and `next_actions.json`. Scout may recommend manual review, static inspection, or a narrow readonly probe, but it still stops before claiming issues, coding, cloning, installing, running repo commands, running package tests, using networked registries, or writing to GitHub.

## Release 2 Dynamic Probe Contract

Release 2 dynamic probing is intentionally small:

- Docker-backed sandbox runner with safe policy validation.
- Network policy `none` only.
- Command set `readonly` only.
- Source staging uses public GitHub source archives, not `git clone`.
- Commands are Scout-generated argv arrays such as `node --version`, `npm --version`, or `python --version`.
- README-suggested commands like `npm install`, `pip install`, `make test`, `docker compose up`, and `curl | bash` are recorded as denied commands with source file/line context, not executed.
- Probe reports add `CommandAttempt`, `SandboxRun`, `probe_config`, `probe_status`, structured setup intelligence, and sandbox command evidence records.
- Docker probes require the sandbox image to be local because Docker pulls are disabled with `--pull never`.
- `setup_status=passed` remains invalid unless a successful matching command attempt exists. Readonly version checks do not imply dependencies were installed or tests passed.

Future networked probes are design-only for now. Registry allowlists, lifecycle-script handling, dependency install probes, package egress logs, and `full_egress_audited` require a later explicit implementation and approval contract.

## Release 2 Autonomy Roadmap

Scout should become more autonomous by gathering safer evidence in layers:

| Phase | Status | Scope |
| --- | --- | --- |
| R2A Sandbox Probe Foundation | done | Current no-network readonly Docker probe contract. |
| R2B Probe Planning Intelligence | done | Structured setup extraction, ecosystem/workspace detection, denied command source context, and next safest action. |
| R2C Sandbox Observability | done | Docker diagnostics, local-image checks, no-pull runner args, cleanup proof, resource summaries, and clearer sandbox status. |
| R2D Network Expansion Design | planned design-only | Registry allowlist, egress logs, lifecycle policy, and exact approval text. No installs. |
| R2E Install Probe Beta | blocked pending R2D | Disabled-by-default dependency install probes with registry allowlist and lifecycle controls. |
| R2F Test Probe Beta | blocked pending R2E | Human-approved allowlisted test execution only after install policy is safe. |
| R2G Decision Cockpit Reports | planned | Candidate comparison, confidence categories, "why not GREEN?", next probe, and coding handoff package. |
| R2H Adversarial Eval Suite | in progress | Malicious setup commands, spoofed output, timeout/cleanup failures, archive tricks, and Windows path escaping coverage. |

Autonomy boundary: Scout may recommend the next safest evidence-gathering step, but it still does not perform GitHub writes, claim issues, fork, branch, open PRs, edit candidate source, or become the coding workflow.
