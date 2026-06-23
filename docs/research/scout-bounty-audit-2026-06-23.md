# Scout bounty discovery audit — 2026-06-23

Baseline audit for `rewarded-hunt` after 0.4.4 OR-collapse. Artifact: [`.scout/benchmark-rewarded-hunt.json`](../../.scout/benchmark-rewarded-hunt.json).

## Executive summary

| Finding | Severity |
|---------|----------|
| Query count reduced to 19 (target ≤25) | Pass |
| 84–100% of search calls return 403 (secondary rate limit) | Critical fail |
| Broad `include_queries` never contribute candidates | Critical fail |
| 0 GREEN shortlist; 0–1 YELLOW | Fail vs target ≥3 |
| Only `org:calcom` unlabeled issues discovered | Signal noise |

**Root cause:** [`collectDiscoveryItems`](../../src/scout/discovery.js) fires ~19 GitHub search requests in a burst (&lt;1s). Primary search quota remains (27–29/30) while GitHub returns 403 for secondary rate limiting. OR-collapse fixed query *volume* but not request *cadence*.

---

## Phase 0.1 — Discovery reliability metrics

### Targets vs actual (benchmark 2026-06-23)

| Metric | Target | nocache lane | cached lane |
|--------|--------|--------------|-------------|
| Query count | ≤25 | 19 | 19 |
| Search audit observed | ~19 | 3 | 6 |
| Search audit failed | 0 | 16 | 13 |
| 403 collection error rate | 0% | 100% | 100% |
| `run_status` | `complete` | `partial` | `partial` |
| Candidates | >0 with reward signal | 0 verified | 0 verified |
| GREEN + YELLOW | ≥3 | 1 | 0 |
| Broad queries in results | 3/3 | 0/3 | 0/3 |

### Per-query discovery (nocache lane)

| Query group | Succeeded | Failed (403) |
|-------------|-----------|--------------|
| `org:calcom` override | 1 (5 candidates) | 0 |
| Seed OR (15 repos) | ~2 (appwrite, n8n in cached lane) | 13–16 |
| Broad include (3) | 0 | 3 |

### Code paths audited

| Module | Behavior | Gap |
|--------|----------|-----|
| [`discovery.js`](../../src/scout/discovery.js) `collectDiscoveryItems` | Sequential search, no delay, no retry | P0 fix |
| [`github-client.js`](../../src/scout/github-client.js) `maybeBackoff` | Only when `remaining < 10` on primary limit | Ignores secondary 403 |
| [`profiles.js`](../../src/scout/profiles.js) `queriesForSeedRepo` | OR collapse live, 19 queries | OK |
| [`discovery-query.js`](../../src/scout/discovery-query.js) | Interleave + broad slot reserve | OK for budget, not API pacing |

### Benchmark harness

- Script: [`scripts/benchmark-rewarded-hunt.mjs`](../../scripts/benchmark-rewarded-hunt.mjs)
- Wired into [`scripts/benchmark-discovery.ps1`](../../scripts/benchmark-discovery.ps1)
- Run: `node scripts/benchmark-rewarded-hunt.mjs --lane nocache` (default; use `cached` or `both` when comparing cache behavior)

### Quiet-period guidance (Wave 2 gate)

Before a live benchmark after code changes or a failed burst run:

1. Wait **30–60 minutes** after the prior `rewarded-hunt` profile run or benchmark (GitHub secondary rate limits are session-scoped).
2. Use `--lane nocache` only for validation gates; avoid `--lane both` unless explicitly comparing cache lanes — back-to-back nocache + cached doubles API pressure.
3. Confirm no other tools are hammering the same `GITHUB_TOKEN` search quota.
4. If 403s persist at 0% target, tune `search_pace_ms` / `search_secondary_cooldown_ms` on `rewarded-hunt` and retry after another quiet window (max 2 tuning iterations before proceeding with documented degraded baseline).

---

## Phase 0.2 — Signal quality audit

### Candidate tabulation (nocache lane, n=5)

All candidates from `org:calcom is:issue state:open no:assignee`:

| Repo | Verdict | `has_verified_reward` | `has_inferred_reward` | `gap_codes` |
|------|---------|----------------------|----------------------|-------------|
| calcom/sans#27 | GRAY | false | false | REWARD_GAP |
| calcom/cal.diy#29623 | YELLOW | false | true | REWARD_GAP |
| calcom/sans#26 | GRAY | false | false | REWARD_GAP |
| calcom/sans#25 | GRAY | false | false | REWARD_GAP |
| calcom/cal.diy#29610 | GRAY | false | false | REWARD_GAP |

No `platform_url` signals. No bounty labels on returned issues.

### False-negative / false-positive risks (validated)

| Risk | Status | Evidence | Module |
|------|--------|----------|--------|
| Calcom org query returns non-bounty noise | **Confirmed** | 5/5 candidates lack verified reward | [`rewarded-programs.json`](../../src/scout/seed-lists/rewarded-programs.json) `search_query` |
| Broad GREEN gate blocks label-only unknown repos | By design | N/A — broad queries never ran | [`triage.js`](../../src/scout/triage.js) `evaluateBroadGreenGate` |
| Spam farms in broad search | Not exercised | Broad queries 403'd | [`bounty-spam.js`](../../src/scout/bounty-spam.js) |
| Body amounts &lt;$25 discarded | By design | No candidates with body amounts | [`reward-signals.js`](../../src/scout/reward-signals.js) |
| CONTRIBUTING hints only at static stage | **Confirmed** | Not invoked during discovery | [`contributing-reward-scan.js`](../../src/scout/contributing-reward-scan.js) |

### Triage gate summary ([`triage.js`](../../src/scout/triage.js))

Rewarded verdict flow:

1. No reward signal → **GRAY** + `REWARD_GAP`
2. Inferred only → **YELLOW**
3. Verified + broad-discovered → `evaluateBroadGreenGate` (needs platform URL, title payout, or ≥$25)
4. Verified + trusted seed → GREEN/YELLOW by score

---

## Phase 0.3 — Cash-in funnel gap

Scout stops at handoff. Manual steps after GREEN:

1. Open `handoff_package.json` / cockpit
2. Verify payout on platform (Algora/IssueHunt) — **not automated**
3. Clone, implement, PR — **agent harness**
4. Claim + await merge/payout — **not in Scout**

See [`bounty-claim-runbook.md`](../../src/scout/runbooks/bounty-claim-runbook.md) and [`handoff-schema-research.md`](handoff-schema-research.md).

---

## Gap matrix — current vs target

| Funnel stage | Current | Target | Priority |
|--------------|---------|--------|----------|
| Search API reliability | Burst → 403 cascade | 100% queries succeed | P0 |
| Seed query precision | Calcom org too broad | Label-scoped or repo-scoped bounty query | P1 |
| Broad discovery | Blocked by 403 | 3 broad queries contribute candidates | P0 |
| Reward signal recall | GitHub metadata only | + CONTRIBUTING prefetch, more platform URLs | P1 |
| Platform verification | URL regex only | Optional API enrich (Algora) | P2 |
| Shortlist quality | 0 GREEN on live runs | ≥3 actionable GREEN/YELLOW | P1 |
| Ranking | Payout sort only | ROI (payout / effort) | P2 |
| Recurring hunts | Manual CLI | Scheduled monitor + alerts | P2 |
| Claim tracking | None | `.scout/claims/` ledger | P3 |

---

## Go / no-go memo (P2+ integrations)

| Integration | Go? | Conditions |
|-------------|-----|------------|
| Search pacing + 403 retry in Scout core | **Go** | P0; no new auth; policy-safe |
| Calcom seed query fix | **Go** | P1; seed-list JSON only |
| CONTRIBUTING.md prefetch at discovery | **Conditional go** | 1 core API call per unique repo; profile flag `prefetch_contributing: true` |
| Algora API enrich | **Research first** | Requires API ToS review, auth model, no scraping |
| IssueHunt API | **Defer** | No clear public API; URL detection sufficient for P1 |
| Claim ledger in `.scout/claims/` | **Go** | Harness-local; no GitHub writes |
| Handoff schema 1.2 | **Go** | Optional fields only; backward compatible |
| Auto-claim / auto-PR | **No** | Policy denied in Scout core |

---

## Recommended execution order

1. Implement P0 search pacing + secondary-limit retry ([`discovery-reliability-design.md`](discovery-reliability-design.md))
2. Re-run benchmark; confirm 0% 403 rate and broad query execution
3. Fix calcom seed `search_query` with label OR clause
4. Expand platform URL patterns ([`bounty-platforms.md`](bounty-platforms.md))
5. Implement ROI ranking research fields ([`roi-ranking-design.md`](roi-ranking-design.md))
6. Enable monitor cadence for `rewarded-hunt`
7. Algora API spike only after P0–P1 green benchmark

---


---

## Benchmark 0.4.7

**Branch:** `scout/0.4.7-discovery-green`  
**HEAD:** `47ac7aa` (discovery interleave + formance `label:bounty` seed override)  
**Date (UTC):** 2026-06-23  
**Preflight:** `npm test` — 290 pass / 0 fail  
**Command:** `node scripts/benchmark-rewarded-hunt.mjs --lane nocache`  
**Artifact:** [`.scout/benchmark-rewarded-hunt.json`](../../.scout/benchmark-rewarded-hunt.json) (`generated_at`: 2026-06-23T06:05:38.737Z)  
**Elapsed:** ~1,120,585 ms (~18.7 min)  
**403 tuning iteration:** not run — `collection_error_403_rate` met target (`0`) on authoritative run; `search_pace_ms` remains `5000` on `rewarded-hunt`.

### Gate vs targets (nocache lane, post-fix)

| Target | Criterion | Actual | Result |
|--------|-----------|--------|--------|
| Query budget | `query_count <= 25` | `20` | **Pass** |
| No secondary 403s | `collection_error_403_rate === 0` | `0` (0/1 collection errors; failure was HTTP **422**, not 403) | **Pass** |
| Broad discovery | `broad_queries_executed >= 3` | `1` / `4` `include_queries` | **Fail** |
| Actionable shortlist | `shortlist_green + shortlist_yellow >= 3` | `3 + 0 = 3` | **Pass** |
| Run completeness | `run_status === "complete"` | `partial` | **Fail** |

**Wave 2 benchmark gate (five rows):** **Fail** (3/5 pass).

### Key metrics (authoritative nocache run)

| Metric | Value |
|--------|-------|
| `cli_exit_code` | 0 |
| `search_audit_observed` / `search_audit_failed` | 19 / 1 |
| `rate_limit_backoff_events` | 9 |
| `collection_error_count` | 1 |
| `collection_error_403_count` | 0 |
| `candidate_count` | 5 |
| `candidates_with_verified_reward` | 5 |
| `candidates_with_platform_url` | 0 |
| `shortlist_green` / `shortlist_yellow` / `shortlist_gray` / `shortlist_red` | 3 / 0 / 0 / 2 |
| `broad_queries_executed` / `broad_queries_expected` | 1 / 4 |
| `discovered_by_query_counts` | `is:issue state:open label:bounty no:assignee stars:>1000` → 5 |
| Failed query | `repo:formancehq/formance is:issue state:open label:bounty no:assignee` → **422** |

### Algora / Wave 5 gate

| Check | Result |
|-------|--------|
| `candidates_with_verified_reward > 0` | **Yes** (`5`) |
| Algora `platform_url` on any candidate | **No** (`candidates_with_platform_url: 0`; no `algora.io` / platform-url signals in shortlist) |

**Wave 5 gate:** **No** (verified-reward signal present, but no Algora platform URL).

### Prior run note (pre-`47ac7aa`)

An earlier nocache benchmark on 2026-06-23 (`generated_at` ~05:11–05:31Z) showed the same 403 pass and shortlist pass, but `broad_queries_executed: 0` and a failed formance query still using a multi-label OR clause. The post-fix run above reflects interleaved broad searches and the shortened formance seed query; broad coverage improved to `1/4` but remains below the ≥3 gate.

### Notes

P0 pacing/backoff eliminated the prior 403 cascade (9 backoff events, 0×403). Remaining Wave 2 gaps: three broad `include_queries` still did not contribute candidates, `run_status` stayed `partial` (formance 422 + incomplete broad coverage), and Wave 5 still lacks an Algora platform-url handoff candidate.

## Benchmark cadence (post 0.5.5)

| Cadence | Command | Purpose |
|---------|---------|---------|
| Daily (cached) | `scout monitor --profile rewarded-cash-in --skip-known --notify` | Actionable GREEN changes without full nocache cost |
| Weekly (nocache) | `node scripts/benchmark-rewarded-hunt.mjs --lane nocache` | Precision + reliability audit |
| Local dev | `scout profile run rewarded-hunt-dev --limit 15` | Fast iteration with cache |

### Precision targets (`.scout/benchmark-rewarded-hunt.json`)

| Metric | Target |
|--------|--------|
| `max_spam_farm_green` | `0` |
| `min_green_from_trusted_or_platform_pct` | `0.8` |
| `candidates_with_platform_url` | `≥1` (Wave 5 / Algora enrich gate) |

## Related documents

- [Discovery reliability design](discovery-reliability-design.md)
- [Bounty platforms survey](bounty-platforms.md)
- [ROI ranking design](roi-ranking-design.md)
- [Handoff schema research](handoff-schema-research.md)
- [Bounty claim runbook](../../src/scout/runbooks/bounty-claim-runbook.md)
