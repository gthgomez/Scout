# Scout post-0.6.1 scorecard — 2026-06-24

> **Status:** Historical scorecard (post-0.6.1) — current operations documented in docs/income-ops.md and docs/architecture/INCOME_FUNNEL_PHASE_CHECKLIST.md.

Live audit after plan implementation (income-first track).

## CI / tests

| Check | Result |
|-------|--------|
| `npm run ci` | **Pass** — 315 tests, 0 failures |
| New tests | `algora-api-enrich.test.js`, competition intel in `roi-ranking.test.js` |
| ScopeHound spike | `npm test` pass (4 tests) |

## Reliability (benchmark)

**Live nocache run** ([`.scout/benchmark-rewarded-hunt.json`](../.scout/benchmark-rewarded-hunt.json), 2026-06-24T22:49Z, ~85 min):

| Gate | Target | Actual | Pass |
|------|--------|--------|------|
| Query budget | ≤25 | **43** | **No** (+issuehunt body query + seed growth) |
| 403 rate | 0% | **33%** (1/3 errors) | **No** |
| GREEN+YELLOW | ≥3 | **0** | **No** |
| `run_status` | complete | partial | No |
| Platform URL candidates | ≥1 | 0 | No |
| Broad queries executed | ≥3/6 | 1/6 | No |
| Spam farm GREEN | 0 | 0 | Yes |

**Findings:** Only 1 candidate (generic `label:bounty stars:>1000`), 1 RED shortlist, 0 actionable GREEN. Failures: `PostHog/posthog` **403** (secondary rate limit after long run), `unkeydev/unkey` **422** (exclude from seed list). Likely compounded by back-to-back API runs (seed audit + benchmark).

**Before next gate run:** wait 30–60 min quiet period; `unkeydev/unkey` removed from seed list (422); consider `rewarded-hunt-dev` for faster iteration.

```powershell
node scripts/benchmark-rewarded-hunt.mjs --lane nocache
```

## Seed query audit (`rewarded-hunt`)

Completed run (2026-06-24, ~18 min): **37 seed queries, 0 with hits** (`seed_queries_with_hits: 0`).

- No open labeled/body bounty issues on trusted seed repos at audit time — reflects current GitHub yield, not a Scout regression.
- `unkeydev/unkey` returned **422** on both label and body queries (candidate for seed-list exclusion, similar to `formancehq/formance`).

Re-run with updated seed body queries (includes `issuehunt.io`):

```powershell
node scripts/audit-seed-queries.mjs --profile rewarded-cash-in
```

## Signal quality / cash-in readiness

| Capability | Status |
|------------|--------|
| `rewarded-cash-in` GREEN-only + ROI rank | Ready |
| Algora public-page enrich | Ready |
| Algora API enrich (`ALGORA_API_KEY`) | Spike ready, HTML fallback |
| IssueHunt label + body queries | **Added** |
| Competition intel (comments, stale claim, open PR) | **Added** |
| Claims ledger + monitor loop | Documented + scripted |
| Platform URL recall on live bench | **Still open** — depends on GitHub yield |

## Income funnel conversion (estimated)

| Stage | Automation | Gap |
|-------|------------|-----|
| Discover GREEN | Scout `rewarded-cash-in` | Seed repos often empty live |
| Verify payout | Manual platform | By design |
| Implement + PR | Agent harness | Outside Scout |
| Claim | Manual + `scout claims` | No auto-claim |

**Near-term income path:** daily `pwsh ./scripts/income-ops.ps1 -Mode daily` → act on exit 1 → `workflow run --profile rewarded-cash-in --workflow-preset full`.

## Security track (ScopeHound spike)

| Component | Status |
|-----------|--------|
| Repo | `Project_AI/ScopeHound/` |
| Scope parser | Implemented |
| Recon orchestrator skeleton | subfinder → httpx → katana → nuclei templates |
| Policy | Report submission always denied |
| Go/no-go for full build | Pending manual validation on authorized program |

## Implemented in this pass

1. Doc drift fixed (README, PROJECT_CONTEXT, Dockerfile → 0.6.1)
2. Scout + ScopeHound added to workspace `PROJECT_CONTEXT.md`
3. `scripts/income-ops.ps1` + `docs/income-ops.md`
4. Platform URL recall: IssueHunt body query + seed body OR
5. Competition intel in `roi-ranking.js` + `candidate-metadata.js`
6. Algora API enrich spike in `algora-api-enrich.js`
7. ScopeHound security bounty skeleton
