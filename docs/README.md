# Scout documentation index

Cold-start index for agents and humans: every doc in the repo, its role, and whether it is current. Navigate in this order: [`README.md`](../README.md) (quick start, presets) → [`PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md) (CLI surface, env vars, artifact contract) → the stage runbooks ([`src/scout/runbooks/README.md`](../src/scout/runbooks/README.md) — safety contracts, must-follow) → [`schemas/README.md`](../schemas/README.md) (artifact shapes). Architecture decisions live under [`architecture/`](architecture/README.md); research and historical audits under [`research/`](research/README.md).

## Index

| Doc | Role | Status |
| --- | --- | --- |
| [`README.md`](../README.md) | Entry point, quick start, workflow + discovery presets | current |
| [`PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md) | CLI surface, env vars, agent artifact contract | current |
| [`AGENTS.md`](../AGENTS.md) | Agent routing, handoff contract | current |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Branch/PR flow, self-hosted CI setup | current |
| [`CHANGELOG.md`](../CHANGELOG.md) | Full release history | current |
| [`.env.example`](../.env.example) | Env var template (GitHub token, Algora key, tuning knobs) | current |
| [`income-ops.md`](income-ops.md) | Canonical claim vocabulary, ops modes (act-top1, scorecard, webhook) | current |
| [`architecture/README.md`](architecture/README.md) | Architecture doc index | current |
| [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md) | Module map + pipeline narrative | current |
| [`architecture/income-funnel.md`](architecture/income-funnel.md) | Income funnel ADR — accepted 2026-07-18 | ADR |
| [`architecture/INCOME_FUNNEL_PHASE_CHECKLIST.md`](architecture/INCOME_FUNNEL_PHASE_CHECKLIST.md) | Phase gates + kill rules | current |
| [`research/README.md`](research/README.md) | Research index (entries carry Status headers) | current |
| [`research/scout-bounty-audit-2026-06-23.md`](research/scout-bounty-audit-2026-06-23.md) | Phase 0 baseline metrics + signal audit | research |
| [`research/discovery-reliability-design.md`](research/discovery-reliability-design.md) | Search pacing + 403 retry design | research |
| [`research/bounty-platforms.md`](research/bounty-platforms.md) | Algora / IssueHunt platform survey | research |
| [`research/algora-api-spike.md`](research/algora-api-spike.md) | Algora API enrich spike (implemented) | research |
| [`research/roi-ranking-design.md`](research/roi-ranking-design.md) | ROI / effort ranking + skill-match design | research |
| [`research/handoff-schema-research.md`](research/handoff-schema-research.md) | Handoff schema 1.2 + claim workflow research | research |
| [`research/scout-scorecard-2026-06-24.md`](research/scout-scorecard-2026-06-24.md) | Post-0.6.1 scorecard — historical | research |
| [`src/scout/runbooks/README.md`](../src/scout/runbooks/README.md) | Runbook index; per-stage allowed/denied CLI ops | current |
| [`src/scout/runbooks/discovery-runbook.md`](../src/scout/runbooks/discovery-runbook.md) | Metadata discovery (`scout workflow run`) | current |
| [`src/scout/runbooks/static-inspection-runbook.md`](../src/scout/runbooks/static-inspection-runbook.md) | Static archive inspection (`scout inspect`) | current |
| [`src/scout/runbooks/dynamic-probe-runbook.md`](../src/scout/runbooks/dynamic-probe-runbook.md) | Docker probes (`scout probe`) | current |
| [`src/scout/runbooks/report-review-runbook.md`](../src/scout/runbooks/report-review-runbook.md) | Report validation + shortlist review | current |
| [`src/scout/runbooks/decision-cockpit-runbook.md`](../src/scout/runbooks/decision-cockpit-runbook.md) | Cockpit drill-down + handoff export | current |
| [`src/scout/runbooks/monitoring-runbook.md`](../src/scout/runbooks/monitoring-runbook.md) | Incremental monitor + notifications | current |
| [`src/scout/runbooks/bounty-claim-runbook.md`](../src/scout/runbooks/bounty-claim-runbook.md) | Claim lifecycle after handoff (income) | current |
| [`schemas/README.md`](../schemas/README.md) | Schema index; runtime validation via `validators.js` | current |
| [`schemas/scout-session-1.0.json`](../schemas/scout-session-1.0.json) | `scout_session.json` manifest | current |
| [`schemas/scout-report-1.0.json`](../schemas/scout-report-1.0.json) | `scout_report.json` report model | current |
| [`schemas/handoff-package-1.1.json`](../schemas/handoff-package-1.1.json) | `handoff_package.json` — beginner intent | current |
| [`schemas/handoff-package-1.2.json`](../schemas/handoff-package-1.2.json) | `handoff_package.json` — rewarded intent | current |

Research entries marked **Superseded** in their Status header are history — read the architecture ADR or the stage runbook for the current design.
