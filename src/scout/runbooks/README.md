# Scout Runbooks

Agent-agnostic stage runbooks for Scout. Each runbook lists allowed/denied Scout CLI operations for that role.

## Primary runbooks

| Runbook | Stage | Entry command |
| --- | --- | --- |
| [discovery-runbook.md](./discovery-runbook.md) | Metadata discovery | `scout workflow run` |
| [static-inspection-runbook.md](./static-inspection-runbook.md) | Static source inspection | `scout inspect` |
| [dynamic-probe-runbook.md](./dynamic-probe-runbook.md) | Docker probes | `scout probe` |
| [report-review-runbook.md](./report-review-runbook.md) | Human/agent report review | `scout validate-report`, `scout explain` |
| [decision-cockpit-runbook.md](./decision-cockpit-runbook.md) | Decision cockpit | `scout cockpit` |
| [monitoring-runbook.md](./monitoring-runbook.md) | Incremental monitor | `scout monitor` |

## Deprecated filename stubs

These files redirect to the runbooks above and are kept for backward-compatible links only:

- `codex-discovery-agent.md` → [discovery-runbook.md](./discovery-runbook.md)
- `codex-static-inspection-agent.md` → [static-inspection-runbook.md](./static-inspection-runbook.md)
- `codex-dynamic-probe-agent.md` → [dynamic-probe-runbook.md](./dynamic-probe-runbook.md)
- `codex-report-review-agent.md` → [report-review-runbook.md](./report-review-runbook.md)
- `codex-monitoring-agent.md` → [monitoring-runbook.md](./monitoring-runbook.md)
