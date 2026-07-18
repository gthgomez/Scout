# ADR: Scout Income Funnel Architecture

| Field | Value |
|-------|--------|
| Status | **Accepted** (ops + yield baseline shipped in 0.6.2) |
| Date | 2026-07-18 |
| Scope | `Project_AI/Scout` income lane only |
| Supersedes | Ad-hoc Release-1 module list as the *operating* model for cash-in |
| Related | [`docs/income-ops.md`](../income-ops.md), [`runbooks/bounty-claim-runbook.md`](../../src/scout/runbooks/bounty-claim-runbook.md), phase checklist |

## Context

Scout 0.6.x is a mature **policy-enforced discovery + triage + handoff** CLI. Live cash conversion lagged because:

1. Discovery optimized for Release-1 safety and query completeness, not closed-loop cash.
2. Human gate → code → PR → paid lived only in runbooks, not in an ops scorecard.
3. Yield collapsed under GitHub secondary rate limits and bloated seed/body query budgets.

**Decision needed:** define a stable funnel architecture so product work, ops scripts, and future modules share one success model—without turning Scout into an auto-claimer or coding agent.

## Decision

Scout owns **stages 1–3** of the income funnel (ingest → filter → package) plus **local ops ledger/scorecard**.  
Humans and external coding agents own **stages 4–6** (gate → execute → collect).  
Auto-claim, auto-PR, and networked install probes remain **out of scope** for this ADR.

### Funnel stages

```text
1 INGEST     Scout CLI     GitHub search, cache, pacing, seeds, optional Algora enrich
2 FILTER     Scout CLI     Spam, reward signals, triage GREEN/YELLOW, ROI rank, competition
3 PACKAGE    Scout CLI     full workflow: static + cockpit + handoff_package.json 1.2
4 HUMAN GATE Operator      Platform verify, stack/effort fit, GO | PASS | WATCH
5 EXECUTE    Agent harness Clone/implement/PR (not Scout); claims ledger updates
6 COLLECT    Operator      Platform claim → paid_at + amount_usd; weekly scorecard
```

### Logical packages (one repo; no npm extract yet)

| Package | Owns | Must not own |
|---------|------|--------------|
| **ingest** | `discovery.js`, `github-client.js`, cache, rate limit, `seed-lists/`, Algora enrich | Triage opinion, ranking |
| **filter** | `triage.js`, `reward-signals.js`, `bounty-spam.js`, `roi-ranking.js` | GitHub writes, payout truth |
| **package** | `workflow.js`, `decision-cockpit.js`, handoff export, `claim-steps.js` | Coding agent execution |
| **ops** | `monitor.js`, `claims-ledger.js`, `income-ops.js`, `scripts/income-ops.ps1`, act-top1, scorecard | Policy engine core |
| **policy** | `policy.js`, `default-policy.yaml`, validators | Business ranking weights |

Code may stay flat under `src/scout/`; these are **ownership boundaries**, not a forced monorepo split.

### Runtime control plane

```text
[Task Scheduler / operator]
        │ daily
        ▼
 income-ops.ps1 -Mode daily
        │
        ▼
 scout monitor (rewarded-cash-in, --skip-known, --notify)
        │ exit 1 + SCOUT_WEBHOOK_JSON
        ▼
 act-top1 dry-run → .scout/act-top1.json
        │ human chooses execute
        ▼
 workflow run --profile rewarded-cash-in --workflow-preset full
        │
        ▼
 handoff_package.json ──► human platform verify
        │ GO
        ▼
 claims ledger (researching → claimed → pr_open → merged → paid)
        │
        ▼
 coding agent (Codex / Claude / etc.) — start from handoff only
        │
        ▼
 weekly: benchmark + seed audit + income-scorecard
```

### Profile roles (income lane)

| Profile | Role |
|---------|------|
| `rewarded-cash-in` | **Primary.** GREEN-only, platform-first, ROI rank, Algora enrich, lean query budget |
| `rewarded-explore` | Fallback when cash-in yields 0 GREEN (YELLOW allowed) |
| `rewarded-hunt-dev` | Local iteration / low API cost |
| `rewarded-hunt` | Broader hunt / weekly reliability bench |
| beginner presets | **Out of income lane** |

### Claim status contract

Canonical (ops + CLI):

```text
researching → claimed → pr_open → merged → paid
                 ↘ abandoned
```

- Monitor skip set: `claimed`, `pr_open`, `merged`, `paid`
- Aliases: `in_progress`→`claimed`, `submitted`→`pr_open` (see `claims-ledger.js`)
- Optional `amount_usd` on `paid` for scorecard

### Success metrics

**North-star (operator):** paid bounties and $/hr—not query count alone.

| Class | KPI | Notes |
|-------|-----|--------|
| Leading (Scout) | Monitor exit 1 rate, GREEN shortlist, platform URL rate, 403 rate, seed hits | Reliability + yield |
| Conversion | Time exit-1 → GO decision; GO count/week | Human gate quality |
| Lagging (money) | Claims paid count, paid USD sum, PR→paid rate | Scorecard + ledger |

Kill/pivot rules (30-day windows) live in the [phase checklist](./INCOME_FUNNEL_PHASE_CHECKLIST.md).

## Consequences

### Positive

- Clear “done” for Scout vs agent harness vs human.
- Ops scripts (`income-ops`, act-top1, scorecard) map 1:1 to architecture stages.
- Yield work (query budget, seeds) is justified by funnel KPIs, not feature sprawl.
- Safe default: Scout never becomes auto-claimer.

### Negative / trade-offs

- Cash still requires operator discipline; empty ledger = empty income.
- Platform-first lean profiles may miss long-tail non-platform bounties (use `rewarded-explore`).
- Logical packages without file moves can drift—enforce via review + this ADR, not folder enforcement alone.

### Explicit non-goals

| Non-goal | Rationale |
|----------|-----------|
| Auto-claim / auto-PR in Scout | Policy + account risk |
| Executable networked install/test probes for income | High risk, low $/hr until first paid |
| Merge ScopeHound into Scout | Different domain |
| Extract `@workspace/agent-contracts` now | Wait for ≥2 production consumers |
| Beginner discovery as income work | Noise |

## Alternatives considered

1. **Scout-as-coding-agent** — Rejected; duplicates Codex/Babel harness, expands policy surface.
2. **Only improve discovery precision** — Insufficient; conversion and claims tracking were the missing loop.
3. **Immediate shared npm packages** — Premature; boundaries first, extract after second consumer.

## Implementation status (snapshot)

| Area | Status as of 0.6.2 |
|------|---------------------|
| Stages 1–3 CLI | Shipped |
| Claims ledger + aliases + stats | Shipped |
| Daily/weekly income-ops + act-top1 + scorecard | Shipped |
| Platform-first lean `rewarded-cash-in` | Shipped |
| Live scheduled ops + first paid | **Operator-owned; not claimed by this ADR** |
| Human-gate auto-checklist fields | Partial (handoff 1.2 + act-top1); checklist phase tracks remainder |
| File-level package move | Deferred |

## References

- Ops runbook: [`docs/income-ops.md`](../income-ops.md)
- Claim runbook: [`src/scout/runbooks/bounty-claim-runbook.md`](../../src/scout/runbooks/bounty-claim-runbook.md)
- Reliability research: [`docs/research/discovery-reliability-design.md`](../research/discovery-reliability-design.md)
- ROI design: [`docs/research/roi-ranking-design.md`](../research/roi-ranking-design.md)
- Live scorecard (historical): [`docs/research/scout-scorecard-2026-06-24.md`](../research/scout-scorecard-2026-06-24.md)
- Phase checklist: [`INCOME_FUNNEL_PHASE_CHECKLIST.md`](./INCOME_FUNNEL_PHASE_CHECKLIST.md)
