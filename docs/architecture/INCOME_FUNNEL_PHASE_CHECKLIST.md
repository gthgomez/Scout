# Scout Income Funnel — Phase Checklist

Companion to [`income-funnel.md`](./income-funnel.md).  
Checkboxes are the operational contract: mark only with evidence (command output, ledger entry, or dated note).

**How to use:** Work top-down. Do not open Phase 4+ until Phase 0 has a real GO/NO-GO log. Prefer updating this file when a gate passes.

---

## Phase 0 — Operate what exists (no new features)

**Goal:** Prove the funnel runs; know if bottleneck is yield vs execution.

| # | Item | Done | Evidence |
|---|------|:----:|----------|
| 0.1 | `GITHUB_TOKEN` (or `GH_TOKEN`) set for full preset | ☐ | |
| 0.2 | Optional `ALGORA_API_KEY` if using Algora API enrich | ☐ | |
| 0.3 | Optional `SCOUT_WEBHOOK_URL` for exit-1 pings | ☐ | |
| 0.4 | Schedule daily: `income-ops.ps1 -Mode daily` | ☐ | Task name / schtasks |
| 0.5 | Schedule weekly: `income-ops.ps1 -Mode weekly` | ☐ | |
| 0.6 | First full cash-in after 30–60 min quiet API window | ☐ | Session dir path |
| 0.7 | Score every shortlist row: GO / PASS / NEED_INFO | ☐ | Note or act-top1 log |
| 0.8 | Touch ledger for any candidate you research | ☐ | `.scout/claims/ledger.json` |
| 0.9 | `scout claims stats` + scorecard non-empty after first touch | ☐ | |

**Phase 0 exit gate**

- [ ] At least one week of daily monitor runs **or** two full cash-in runs with written GO/NO-GO counts
- [ ] Bottleneck labeled: `yield` | `human_gate` | `execution` | `market_empty`

---

## Phase 1 — Yield reliability (Scout code)

**Goal:** Search budget and seeds produce actionable platform-linked candidates without 403 collapse.

| # | Item | Done | Evidence |
|---|------|:----:|----------|
| 1.1 | `rewarded-cash-in` query count ≤ 25 | ☑ | 0.6.2: ~19 queries |
| 1.2 | Platform-first include queries | ☑ | `profiles.js` cash-in preset |
| 1.3 | Seed body dual-queries off for cash-in | ☑ | `seed_body_queries: false` |
| 1.4 | Prune 422 / dead seeds; exclude unkey | ☑ | seed-lists + exclude_repos |
| 1.5 | Prefer quiet period before weekly nocache | ☐ | Ops habit |
| 1.6 | Weekly nocache: 403 rate ≤ 10% | ☐ | `.scout/benchmark-rewarded-hunt.json` |
| 1.7 | Weekly: ≥1 candidate with platform URL **or** documented empty market | ☐ | |
| 1.8 | Fallback: one `rewarded-explore` when cash-in 0 GREEN for ≥7 days | ☐ | Session path |
| 1.9 | Optional: Algora API list path if key beats GitHub body search | ☐ | Spike note |

**Phase 1 exit gate**

- [ ] Two consecutive weekly gates meet 403 + platform-URL (or empty-market) criteria
- [ ] No increase of cash-in queries above 25 without ADR amendment

---

## Phase 2 — Conversion packaging

**Goal:** Exit 1 → coding agent start in ≤ 30 minutes for a GO.

| # | Item | Done | Evidence |
|---|------|:----:|----------|
| 2.1 | act-top1 ranks GREEN/YELLOW by ROI | ☑ | `scripts/act-top1.mjs` |
| 2.2 | act-top1 `--execute` runs full workflow | ☑ | |
| 2.3 | Handoff 1.2 claim_steps / platform / ROI fields on rewarded | ☑ | schema 1.2 |
| 2.4 | Rich webhook payload (top id, ROI, URLs) | ☑ | `income-ops.js` + notify |
| 2.5 | Human-gate checklist auto-filled from handoff unknowns | ☐ | |
| 2.6 | Competition refresh at package time (stale claim / open PR) | ☐ | |
| 2.7 | Claim status vocab single source (CLI = runbook = docs) | ☑ | 0.6.2 |
| 2.8 | Timed GO: measured exit-1 → agent start ≤ 30 min | ☐ | |

**Phase 2 exit gate**

- [ ] Two GO candidates packaged and started in harness within 30 min each
- [ ] No coding started from rediscovery when valid `handoff_package.json` exists

---

## Phase 3 — Ops scoreboard

**Goal:** Weekly answer: “Did Scout make money or save time?”

| # | Item | Done | Evidence |
|---|------|:----:|----------|
| 3.1 | Claims ledger + `claims stats` | ☑ | |
| 3.2 | Income scorecard md/json | ☑ | `.scout/income-scorecard.*` |
| 3.3 | Weekly mode runs scorecard after bench | ☑ | `income-ops.ps1 -Mode weekly` |
| 3.4 | Persist personal profile: preferred languages, min USD, effort ceiling | ☐ | Profile or local note |
| 3.5 | Webhook always includes top candidate (not just “fired”) | ☑ | |
| 3.6 | First `paid` claim with `amount_usd` | ☐ | ledger |
| 3.7 | Four consecutive weeks of scorecard files retained | ☐ | |

**Phase 3 exit gate**

- [ ] ≥1 paid claim **or** explicit 30-day kill decision with data
- [ ] Scorecard reviewed weekly (date stamps)

---

## Phase 4 — After first paid only (optional)

**Do not start until Phase 3 exit gate (paid or kill) is decided.**

| # | Item | Done | Evidence |
|---|------|:----:|----------|
| 4.1 | OpenClaw/webhook notify on high-ROI GREEN only | ☐ | |
| 4.2 | Second bounty source (IssueHunt API research) | ☐ | |
| 4.3 | Install-probe beta only if static ambiguity blocks claims | ☐ | Separate approval |
| 4.4 | ScopeHound go/no-go (economics vs Scout $/hr) | ☐ | |
| 4.5 | Extract shared handoff/policy package (≥2 consumers) | ☐ | |

---

## Kill / pivot rules (always on)

| Condition (≈30 days) | Action |
|----------------------|--------|
| 0 GO candidates with open platform bounties | Expand sources (Algora-first); do not add R2 probes |
| ≥3 GO but 0 PRs | Execution bottleneck—fix harness time, not Scout discovery |
| ≥2 merged PRs, 0 paid | Claim/platform process—not discovery |
| Scout cash $/hr proven and operator wants vuln lane | ScopeHound trial; keep repos separate |

---

## Operator weekly ritual (copy into daily memory if useful)

```text
[ ] income-ops daily running (or manual N times)
[ ] claims stats reviewed
[ ] scorecard md skimmed
[ ] any GO → ledger status current
[ ] if 0 GREEN all week → one rewarded-explore OR seed audit note
[ ] if 403 storm → wait 30–60m; do not thrash weekly nocache
```

---

## Changelog (checklist)

| Date | Note |
|------|------|
| 2026-07-18 | Checklist created; Phase 1.1–1.4 and ops tooling marked done via 0.6.2 |
