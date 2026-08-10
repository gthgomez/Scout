# ROI ranking and skill-match design

> **Status:** Implemented (0.5.0–0.5.4) — `roi-ranking.js`; `rank_shortlist_by` defaults to `roi` for rewarded presets.

Research for Phase 3 triage upgrades. Goal: rank bounties by **expected cash-in probability**, not just payout amount.

## Current behavior

[`triage.js`](../../src/scout/triage.js):

- `rank_shortlist_by_payout: true` on `rewarded-hunt` sorts by `estimated_reward_usd` descending
- Score bonuses: trusted seed (+20), verified reward (+30), inferred (+15), payout mention (+10)
- No effort estimate, no stack fit beyond +10 for Python/TS/JS

**Gap:** A $500 bounty on a stale, claimed, or unfamiliar stack ranks above a $100 easy TypeScript fix.

## Proposed candidate fields

| Field | Type | Source | Purpose |
|-------|------|--------|---------|
| `estimated_effort_hours` | number \| null | Heuristic | Denominator for ROI |
| `estimated_reward_usd` | number \| null | Existing | Numerator |
| `roi_score` | number \| null | `reward / max(effort, 1)` | Sort key |
| `claim_friction_score` | 0–100 | Composite | Lower = easier to cash in |
| `stack_fit_score` | 0–100 | Profile match | User skill alignment |

All fields **inferred** — never presented as verified payout.

## Effort heuristic (research)

| Signal | Weight | Rationale |
|--------|--------|-----------|
| Issue body length &lt;500 chars | −2h | Likely small |
| Body length &gt;3000 chars | +4h | Complex spec |
| Labels: `good first issue`, `documentation` | −3h | Smaller scope |
| Labels: `epic`, `refactor` | +6h | Large scope |
| `estimated_files_touched` &gt;3 | +2h per file over 3 | From static inspection when available |
| Linked PR likely solves | +∞ (hard drop) | Not actionable |
| Comments &gt;20 | +2h | High discussion overhead |

```js
estimated_effort_hours = clamp(1, 40,
  base(4) + bodyLengthFactor + labelFactor + fileTouchFactor
)
```

## Claim friction score (research)

| Factor | Points (lower friction = higher score) |
|--------|----------------------------------------|
| `platform_url` present | +25 |
| `has_verified_reward_signal` | +20 |
| No assignee | +15 |
| Maintainer activity &lt;30d | +15 |
| `claimed_in_comments` | −50 |
| Linked solving PR | −100 (drop) |
| Outside trusted seed (broad) | −10 |

`claim_friction_score = sum(clamp 0, 100)`

## Stack fit (profile extensions)

Proposed profile fields in [`validators.js`](../../src/scout/validators.js):

```js
preferred_languages: ["TypeScript", "Python"]  // optional
excluded_languages: ["Rust", "Go"]               // optional
max_repo_stars: 50000                          // optional
min_repo_stars: 100                            // optional
```

Scoring:

```js
stack_fit_score = 50
  + (primary_language in preferred ? 30 : 0)
  - (primary_language in excluded ? 40 : 0)
  + (stars in range ? 20 : 0)
```

## Combined rank key

Replace or augment `rank_shortlist_by_payout`:

```js
profile.rank_shortlist_by = "roi" | "payout" | "score"  // default "roi" for rewarded-hunt v2

sortKey = (candidate) => {
  if (rankBy === "roi") return candidate.roi_score ?? 0;
  if (rankBy === "payout") return candidate.estimated_reward_usd ?? 0;
  return decision.score;
}
```

## Triage gate A/B study (manual research protocol)

When P0 pacing enables full discovery:

| Variant | `broad_green_min_usd` | `require_trusted_or_platform_for_broad_green` |
|---------|----------------------|-----------------------------------------------|
| A (current) | 25 | true |
| B | 50 | true |
| C | 25 | false |

For each: label top 20 candidates manually as `actionable` | `noise` | `spam`. Compute precision/recall.

## Implementation phases

| Phase | Scope |
|-------|-------|
| Research only | This document |
| P2a | `estimated_effort_hours` + `roi_score` on candidates (discovery/triage) |
| P2b | `rank_shortlist_by` profile field |
| P2c | `preferred_languages` / `excluded_languages` |
| P3 | `claim_friction_score` in cockpit + handoff |

## Files to touch (when implementing)

| File | Change |
|------|--------|
| [`triage.js`](../../src/scout/triage.js) | `computeEffortEstimate`, `computeRoiScore`, sort |
| [`validators.js`](../../src/scout/validators.js) | Profile fields |
| [`profiles.js`](../../src/scout/profiles.js) | `rewarded-hunt` defaults |
| [`report.js`](../../src/scout/report.js) | Shortlist columns for ROI |
| [`schemas/scout-report-1.0.json`](../../schemas/scout-report-1.0.json) | Optional fields |

## Cockpit display (research)

Add to decision cockpit row:

- `roi_score`, `estimated_effort_hours`, `claim_friction_score`, `stack_fit_score`
- Human note: "ROI is heuristic; confirm effort before claiming."
