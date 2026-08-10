# Handoff schema 1.2 — claim workflow extension research

> **Status:** Superseded by handoff-package-1.2.json (0.5.1) — emit trigger is `discovery_intent === "rewarded"` (the proposed `SCOUT_HANDOFF_SCHEMA` env var was never implemented); `platform_name` enum includes `opire`; ledger statuses include `researching`.

Research for Phase 5 cash-in funnel. Base schema: [`schemas/handoff-package-1.1.json`](../../schemas/handoff-package-1.1.json).

## Principle

Scout must **never** set `payout_verified_externally: true`. All platform verification is harness/human responsibility per [`AGENTS.md`](../../AGENTS.md).

## Proposed schema_version: 1.2

Backward compatible: 1.1 packages remain valid; 1.2 adds optional fields only.

### Package-level additions

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `claim_workflow_version` | `"1.0"` | optional | Runbook version reference |
| `bounty_disclaimer` | string | existing `reward_disclaimer` | Clarify Scout does not verify payout |

### Per-entry additions (`handoffPackageEntry`)

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `platform_claim_url` | string \| null | no | Best-effort URL from `platform_url` reward signal |
| `platform_name` | `"algora"` \| `"issuehunt"` \| `"unknown"` \| null | no | Parsed from signals |
| `payout_verified_externally` | boolean | no | **Always false from Scout** |
| `acceptance_criteria_summary` | string \| null | no | First 500 chars of criteria extraction |
| `suggested_branch_name` | string \| null | no | `bounty/{owner}-{issue_number}` template |
| `claim_steps` | string[] | no | Platform-specific checklist lines |
| `roi_score` | number \| null | no | From ROI design when implemented |
| `estimated_effort_hours` | number \| null | no | Heuristic |

### Example entry fragment

```json
{
  "candidate_id": "SCOUT-appwrite-appwrite-12345",
  "verdict": "GREEN",
  "platform_name": "algora",
  "platform_claim_url": "https://algora.io/bounties/abc123",
  "payout_verified_externally": false,
  "suggested_branch_name": "bounty/appwrite-12345",
  "claim_steps": [
    "Open platform_claim_url and confirm bounty status is OPEN",
    "Read acceptance criteria in issue body",
    "Comment intent to work (manual; Scout does not post)",
    "Fork, branch, implement, open PR linking issue",
    "Submit claim on Algora console after PR opened"
  ],
  "agent_notes": "Scout metadata only. Verify payout on platform before investing effort."
}
```

## Mapping from existing signals

| Handoff field | Source |
|---------------|--------|
| `platform_claim_url` | `reward_signals` where `kind === "platform_url"` |
| `platform_name` | `reward_signals[].platform` |
| `acceptance_criteria_summary` | `candidate.has_acceptance_criteria` + body excerpt |
| `suggested_branch_name` | Template from `repo_owner`, `issue_number` |
| `claim_steps` | Static templates per `platform_name` in runbook |

## Claim ledger (`.scout/claims/`)

Separate from handoff schema — local state file:

```json
{
  "claims": [
    {
      "issue_url": "https://github.com/org/repo/issues/1",
      "candidate_id": "SCOUT-org-repo-1",
      "status": "claimed|pr_open|merged|paid|abandoned",
      "platform_claim_url": "...",
      "pr_url": null,
      "claimed_at": "2026-06-23T00:00:00.000Z",
      "paid_at": null,
      "notes": ""
    }
  ]
}
```

**Integration:** `scout monitor --skip-known` should load ledger and exclude `claimed`/`paid` issue keys.

## Agent harness consumption

[`decision-cockpit.js`](../../src/scout/decision-cockpit.js) `buildHandoffPackage` should populate new fields when schema 1.2 is adopted.

OpenClaw/Codex handoff prompt should include:

1. `platform_claim_url` as first human verification step
2. `claim_steps[]` as ordered checklist
3. Explicit `payout_verified_externally: false` reminder

## Migration path

1. Publish `handoff-package-1.2.json` schema (optional fields)
2. `validateHandoffPackage` accepts 1.1 and 1.2
3. `exportHandoffPackages` emits 1.2 when `SCOUT_HANDOFF_SCHEMA=1.2` or profile flag
4. Update [`decision-cockpit-runbook.md`](../../src/scout/runbooks/decision-cockpit-runbook.md)

## Policy gates (no-go)

- Auto-populate `payout_verified_externally: true` from GitHub title amounts
- Auto-generate GitHub comments or PRs from Scout CLI
- Store API keys for Algora in handoff package
