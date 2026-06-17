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
- Release 2 implemented through R2C: approval-bound Docker-backed readonly probes for one statically inspected candidate at a time, structured setup intelligence, denied command provenance, local Docker/image preflight, no-pull fail-closed behavior, and sandbox resource/cleanup reporting.
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

`probe doctor` checks whether the Docker CLI and local sandbox image are available. The Docker runner performs the same local-image preflight before creating a sandbox and uses `--pull never`; if the image is missing, Scout fails closed instead of pulling from a registry.

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
- Sandbox reports include image ref/digest when available, network policy, resource limits, lifecycle status, and cleanup status.
- `setup_status=passed` remains invalid unless a successful matching command attempt exists. Readonly version checks do not imply dependencies were installed or tests passed.

Future networked probes are design/dry-run only for now. Scout has R2D contract helpers for registry allowlist approval text, lifecycle-script policy, and future egress log records. It also has R2E dry-run helpers for proposed install probes and R2G decision-cockpit helpers. The executable CLI still supports only `--network none --command-set readonly`. Dependency install execution, test execution, package egress enforcement, and `full_egress_audited` require a later explicit implementation and approval contract.

## Release 2 Autonomy Roadmap

Scout should become more autonomous by gathering safer evidence in layers:

| Phase | Status | Scope |
| --- | --- | --- |
| R2A Sandbox Probe Foundation | done | Current no-network readonly Docker probe contract. |
| R2B Probe Planning Intelligence | done | Structured setup extraction, ecosystem/workspace detection, denied command source context, and next safest action. |
| R2C Sandbox Observability | done | Docker diagnostics, local-image fail-closed preflight, no-pull runner args, image ref/digest reporting, cleanup proof, resource summaries, and clearer sandbox status. |
| R2D Network Expansion Design | done design-only | Registry allowlist contract, egress log shape, lifecycle policy, and exact approval text. No installs. |
| R2E Install Probe Dry Run | done dry-run | Builds proposed install-probe plans from R2D contracts and static setup intelligence. No installs. |
| R2F Test Probe Design Gate | done design-only | Produces blocked test-probe design plans requiring install-probe evidence before any future execution. |
| R2G Decision Cockpit Reports | done helper | Candidate confidence categories, "why not GREEN?", next evidence action, and advisory coding handoff package. |
| R2H Adversarial Eval Suite | done | 33 adversarial tests covering Windows path escaping (backslash, drive letters, UNC, DOS devices), NULL byte injection, malicious setup commands, spoofed output, false pass claims, archive tricks, and integrated multi-vector scenarios. |

Autonomy boundary: Scout may recommend the next safest evidence-gathering step, but it still does not perform GitHub writes, claim issues, fork, branch, open PRs, edit candidate source, or become the coding workflow.

## R2D Network Expansion Design

R2D defines future-network contracts only. The helpers validate registry host allowlists, lifecycle-script policy, approval phrase coverage, and future egress log records. They do not add a CLI command and do not make `registry_allowlist` executable.

Example future approval phrase shape:

```text
APPROVE SCOUT R2D SCOUT-alpha-green-1 acme/tooling https://github.com/acme/tooling/issues/12 registry_allowlist registry.npmjs.org pypi.org files.pythonhosted.org install_probe_design scripts_disabled 120 retain_stdout_stderr_7_days
```

That phrase must name the candidate ID, repo, issue, network policy, registry hosts, command set, lifecycle policy, timeout, and artifact retention. Runtime probes must continue rejecting `registry_allowlist` until a later approved implementation consumes the R2D contract.

## R2E-R2G Dry-Run And Report Helpers

R2E install-probe helpers consume an R2D contract plus static setup intelligence and render proposed install commands as dry-run text only. Plans always use `execution_status=not_executed`; they never create `CommandAttempt` records and never set `setup_status=passed`.

R2F test-probe design helpers remain blocked behind future install-probe evidence. They can identify static manifest-derived test commands, but test execution is not implemented.

R2G decision-cockpit helpers summarize confidence categories, why a candidate is not `GREEN`, what evidence would change the decision, the next safest evidence action, and an advisory handoff package. The handoff does not clone, claim, branch, push, open PRs, or write to GitHub.
