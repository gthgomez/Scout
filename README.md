# Scout

Scout is a Codex-driven, policy-enforced local tool for finding beginner-realistic open-source contribution candidates.

Release 1 scope:

- GitHub metadata discovery.
- Saved search profiles.
- Metadata-only monitoring.
- Deterministic triage and portfolio scoring.
- Evidence-backed Markdown reports.
- Policy denials before unsafe operations.

Release 1 denies:

- `git clone`
- package installs
- repo scripts
- shell commands from candidate repos
- Docker actions
- GitHub comments, forks, pushes, branches, and PRs
- dynamic setup probes

Primary UX is Codex orchestration. The CLI is the deterministic backend and test harness.

## Codex Workflow

```powershell
npm test
node src/scout/cli.js profile create beginner-python --languages Python --labels "good first issue,help wanted"
node src/scout/cli.js monitor --profile beginner-python --out scout_watch_report.md --json-out scout_watch_report.json
node src/scout/cli.js inspect --report scout_watch_report.json --manifest manifest.json --out scout_static_report.md --json-out scout_static_report.json
node src/scout/cli.js validate-report --report scout_static_report.json
node src/scout/cli.js export-shortlist --report scout_static_report.json --limit 25 --out scout_shortlist.md
```

Scout stores local profiles and monitor snapshots under `.scout/`. That directory is ignored by Git because it is runtime state, not source code.
