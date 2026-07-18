# Changelog

## [0.6.2] — Income ops pack + cash-in yield budget

### Added
- Architecture ADR + phase checklist: `docs/architecture/income-funnel.md`, `INCOME_FUNNEL_PHASE_CHECKLIST.md`
- Claim status aliases (`in_progress`→`claimed`, `submitted`→`pr_open`, …) + `claims stats`
- Optional `amount_usd` / `amount_currency` on claims ledger for cash scorecard
- `src/scout/income-ops.js` — top-candidate ranking, webhook payload, scorecard helpers
- `scripts/act-top1.mjs` — pick top GREEN/YELLOW and optional full workflow
- `scripts/income-scorecard.mjs` + `scripts/webhook-payload.mjs`
- `income-ops.ps1` modes: `daily` (rich webhook + act-top1 dry-run), `act`, `scorecard`, `weekly` (+ scorecard)

### Changed
- `rewarded-cash-in`: platform-first queries, seed body dual-queries off, leaner seeds, query budget ≤25 intent
- Seed lists pruned (drop low-yield / 422 repos; exclude `unkeydev/unkey`)
- Monitor `--notify` emits `SCOUT_TOP` + `SCOUT_WEBHOOK_JSON` lines
- Docs: `docs/income-ops.md` aligned with canonical claim vocabulary

## [0.6.1] — Discovery yield improvement

### Added
- Dual seed queries: OR-label + `algora.io` / `console.algora.io` in-body (`trusted_seed_body` kind)
- Per-repo `search_queries` array overrides in trusted seed lists
- `scripts/audit-seed-queries.mjs` — seed query hit-count audit
- `rewarded-explore` preset — YELLOW shortlist, relaxed `green_requires_platform_or_trusted`
- `discovery_query_stats` on reports + **Discovery Coverage** markdown table
- `scout discover --profile <id> --query-stats-only` — search stats without enrich/triage
- Profile fields: `seed_body_queries`, `require_unassigned`, `max_issues_per_seed_query`, `max_issues_per_platform_query`, `seed_search_max_pages`
- Benchmark targets: `min_seed_queries_with_hits`, `min_platform_query_hits`
- Seed search pagination (up to `seed_search_max_pages` for seed queries)
- Opire broad query and `in:title` bounty broad query

### Changed
- Platform broad queries use `stars:>100`; generic `label:bounty` capped at 1 item per query
- Platform broad queries cap at 4 items; seed queries at 5
- Expanded `rewarded-programs-algora` seed list to 10 repos
- `rewarded-cash-in` enables `algora_platform_enrich: true`
- Spam hard-drop skips `[$NN BOUNTY]` titles when OBSERVED `platform_url` is present
- `isFromTrustedSeedList` includes `trusted_seed_body` observations

## [0.6.0] — Algora read-only enrich (gated)

### Added
- `algora-enrich.js` — optional read-only Algora public-page status/amount parse behind `algora_platform_enrich` (default `false`)
- Candidate fields `platform_status_observed`, `platform_amount_observed` with `INFERRED` source observations
- Policy operation `bounty_platform_metadata_read` for controlled platform page fetch

### Changed
- Discovery enrichment pipeline invokes Algora enrich when profile flag is enabled

## [0.5.5] — Operational loop

### Added
- `rewarded-hunt-dev` preset — 15-candidate cap, two platform-first broad queries, cache-friendly local iteration
- `workflow-rewarded.test.js` — E2E handoff schema 1.2 with Algora `claim_steps`
- Monitoring runbook: daily `rewarded-cash-in` monitor, weekly nocache benchmark cadence

### Changed
- CLI help banner → Scout 0.6.0

## [0.5.4] — Ranking and report value

### Added
- `rewarded-cash-in` preset — GREEN-only shortlist requiring trusted seed or platform URL; ROI-ranked
- `computeRoiScoreInferred`, `resolveRankingKey`, `formatDiscoverySource` in `roi-ranking.js`
- Report **Source** and **Friction** columns on rewarded shortlist tables
- ROI display for non-USD via `~N.NN (CURRENCY)` inferred label

### Changed
- ROI shortlist sort uses `roi_score_inferred` fallback and `claim_friction_score` tiebreak

## [0.5.3] — Discovery rebalance

### Added
- Profile fields `max_issues_per_broad_query`, `min_seed_candidate_slots`, `exclude_repos`
- Per-broad-query candidate caps and seed slot reservation in `discovery-query.js`

### Changed
- `rewarded-hunt` platform-first `include_queries`; generic `label:bounty` last
- `rewarded-hunt` excludes `Scottcjn/rustchain-bounties`
- Removed `formancehq/formance` from `rewarded-programs-algora` (persistent 422)

## [0.5.2] — Shortlist precision

### Added
- Profile flag `green_requires_platform_or_trusted` on `rewarded-hunt`
- Expanded `bounty-spam.js` heuristics: `[BOUNTY]` titles, rustchain/RTC farm patterns, hard-drop on high-confidence farms
- Benchmark precision targets: `max_spam_farm_green`, `min_green_from_trusted_or_platform_pct`

### Changed
- Broad GREEN gate: title verified reward requires `kind === "amount"` (not keyword)
- GREEN on broad requires platform URL, trusted seed, or USD ≥ `broad_green_min_usd` when flag enabled

## [0.5.1] — Handoff package schema 1.2

### Added
- [`schemas/handoff-package-1.2.json`](schemas/handoff-package-1.2.json) — optional claim-workflow fields on package entries
- `claim-steps.js` — static claim step templates per platform (`algora`, `issuehunt`, `opire`, `unknown`)
- Rewarded handoff entry fields: `platform_claim_url`, `platform_name`, `payout_verified_externally`, `claim_steps`, `suggested_branch_name`, `roi_score`, `estimated_effort_hours`, `acceptance_criteria_summary`
- Cockpit row display for `roi_score`, `estimated_effort_hours`, and `claim_friction_score` on rewarded sessions

### Changed
- `validateHandoffPackage()` accepts schema versions `1.1` and `1.2`
- `exportHandoffPackages()` emits schema `1.2` when `discovery_intent === "rewarded"`, otherwise `1.1`

## [0.5.0] — ROI ranking and claim ledger

### Added
- `roi-ranking.js` — `estimated_effort_hours`, `claim_friction_score`, `stack_fit_score`, `roi_score` heuristics
- Profile `rank_shortlist_by`: `"roi"` | `"payout"` | `"score"`; back-compat `rank_shortlist_by_payout: true` → `"payout"`
- Profile fields `preferred_languages`, `excluded_languages`, `min_repo_stars`, `max_repo_stars`
- `rewarded-hunt` default `rank_shortlist_by: "roi"`
- Rewarded shortlist columns: ROI score and estimated effort hours
- `claims-ledger.js` — local `.scout/claims/ledger.json` with `load`/`save`/`upsert`/`claimIssueKeys`
- CLI `scout claims list|add|update`
- Monitor merges active claim keys into discovery skip set

### Changed
- Triage attaches ROI fields during `triageCandidate` and sorts shortlist by `rank_shortlist_by`

## [0.4.7] — Discovery pacing and cooldown

### Added
- `createSearchSessionGuard` — inter-request pace plus session cooldown after secondary rate-limit hits
- `resolveSearchSecondaryCooldownMs` — env `SCOUT_SEARCH_SECONDARY_COOLDOWN_MS` (default 60000, cap 120s with exponential bump)
- Profile field `search_secondary_cooldown_ms`; `rewarded-hunt` preset `search_pace_ms: 5000`
- Formance seed `search_query` override (3-label OR) in `rewarded-programs-algora`
- Benchmark harness `--lane nocache|cached|both` (default `nocache`)

### Changed
- Default `SCOUT_SEARCH_PACE_MS` raised from 2500 to 4000
- GitHub client calls `onSecondaryLimitHit()` on each secondary 403/429 retry attempt
- CONTRIBUTING scan promotes all `extractPlatformUrls` hits (algora, issuehunt, opire)

## [0.4.6] — Bounty discovery P1

### Added
- `contributing-prefetch.js` — optional `prefetch_contributing` fetches CONTRIBUTING.md per repo during discovery enrichment
- Profile fields: `prefetch_contributing`, `search_pace_ms`, `search_max_retries`
- Opire platform URL detection in `reward-signals.js`
- Broad `issuehunt` query on `rewarded-hunt` preset

### Changed
- Calcom seed `search_query` scopes org search to reward label OR clause (reduces non-bounty noise)
- `rewarded-hunt` / `rewarded-trusted-only` enable CONTRIBUTING prefetch; `seed_reward_labels` includes `issuehunt`
- GitHub client accepts profile-level search pace/retry overrides

## [0.4.5] — Search pacing and retry

### Added
- `github-search-policy.js` — search pace/retry helpers (`SCOUT_SEARCH_PACE_MS`, `SCOUT_SEARCH_MAX_RETRIES`)
- Collection errors include `error_kind` and `retry_count` for failed searches

### Changed
- `searchIssues` paces requests (default 2.5s between searches) and retries secondary-rate-limit 403/429 with backoff
- Failed search responses capture response body for error classification

## [0.4.4] — Seed query rate-limit fix

### Changed
- Seed-list query generation collapses multiple labels into one OR query per repo (one per language when languages are set), cutting `rewarded-hunt` from ~94 GitHub search calls to ~19

### Fixed
- `rewarded-hunt` and `rewarded-trusted-only` runs exhausting the 30/min GitHub search rate limit before broad `include_queries` execute (mass 403 collection errors)

## [0.4.3] — Discovery fix sprint

### Added
- Profile fields: `seed_reward_labels`, `max_issues_per_query`, `interleave_discovery_queries`, `reserve_broad_query_slots`, `broad_green_min_usd`, `require_trusted_or_platform_for_broad_green`
- `discovery-query.js` — query descriptor helpers (`isBroadDiscoveryCandidate`, interleave/slot budgeting)
- `contributing-reward-scan.js` — CONTRIBUTING.md bounty/program signal scan in static inspection
- Non-USD reward parsing: RTC, USDC, USDT title patterns; `estimated_reward_amount`, `reward_currency` on candidates
- Seed repo `search_query` override — `calcom/cal.com` uses `org:calcom` scope to avoid GitHub search 422

### Changed
- `rewarded-hunt` and `rewarded-trusted-only` presets — label-scoped seed queries, per-query caps, interleaved discovery, reserved broad-query slots, broad GREEN quality gate (`broad_green_min_usd: 25`)
- `discoverCandidates` — round-robin interleave, `max_issues_per_query`, `reserve_broad_query_slots` so broad bounty queries are not starved by seed repos
- Broad-discovered GREEN requires platform URL, verified payout ≥ $25, or trusted seed; label-only unknown repos capped at YELLOW
- Report shortlist shows non-USD reward currency with verify note

### Fixed
- Full `rewarded-hunt` runs returning 0 GREEN/YELLOW because Appwrite seed queries monopolized the discovery limit
- `repo:calcom/cal.com` GitHub search 422 via org-scoped seed override

## [0.4.2] — Bounty discovery sprint

### Added
- `rewarded-hunt` preset — dual seed lists (`rewarded-programs`, `rewarded-programs-algora`) plus bounded Algora/bounty broad queries; inferred rewards OK; payout-ranked shortlist
- `rewarded-programs-algora` seed list — 7 curated Algora-active repos with no overlap against `rewarded-programs`
- `extractPlatformUrls()` — Algora and IssueHunt URL detection as verified `platform_url` reward signals
- `parseRewardAmount()` — contextual amount parsing with stack-trace false-positive filter (body-only amounts &lt; $25 discarded unless label or platform URL present)
- `src/scout/reward-signals.js` module — labels → URLs → keywords → amounts orchestration in `extractRewardSignals`
- Tests: `reward-signals.test.js`, `rewarded-hunt.test.js`; seed-list overlap coverage for Algora list

### Changed
- `has_verified_reward_signal` now treats `platform_url` signals as OBSERVED verification metadata
- Docs: README, PROJECT_CONTEXT, discovery runbook — `rewarded-hunt` preset row

## [0.4.1] — Schemas + doc polish

### Added
- [`schemas/scout-report-1.0.json`](schemas/scout-report-1.0.json) and [`schemas/scout-session-1.0.json`](schemas/scout-session-1.0.json)
- [`schemas/README.md`](schemas/README.md) — schema index and runtime validator map
- `validateSessionManifest()` — validates `scout_session.json` on save
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — local CI, PR flow, self-hosted runner setup

### Changed
- README, PROJECT_CONTEXT, AGENTS, runbooks: artifact contract, CLI table, `repo_size_filter` semantics, schema links
- `.env.example` — optional `SCOUT_*` and `SCOUT_WEBHOOK_URL` (wrapper-only)
- `scout --help` banner updated to 0.4.x
- Removed deprecated `codex-*-agent.md` runbook redirect stubs

### Deferred
- OpenClaw/Slack native monitor notifications

## [0.4.0] — Handoff schema + seed filters

### Added
- [`schemas/handoff-package-1.1.json`](schemas/handoff-package-1.1.json) — JSON Schema for `handoff_package.json`
- `validateHandoffPackage()` — validates handoff exports by default in `exportHandoffPackages`

### Changed
- `repo_size_filter` applied to trusted seed-list queries and broad profile-generated queries
- Removed `codex_summary.md` from workflow discover output (use `agent_summary.md`)

### Deferred
- JSON Schema for `scout_report.json`

## [0.3.4] — Handoff mode from evidence

### Fixed
- `handoff_mode` now reflects archive-backed static evidence outcomes, not fetch intent — full preset with failed or insufficient archives yields `metadata_only`
- Cockpit metadata-only banner shows when `handoff_mode` is `metadata_only` even after a full preset attempt

### Added
- `deriveHandoffMode()` helper and `handoff_mode_reason` on `handoff_package.json` when mode is `metadata_only`

### Changed
- Runbooks: decision cockpit, report review, and static inspection updated for 0.3.3+ workflow preset and handoff semantics
- Docs: `handoff_mode` derived from evidence, not preset alone

## [0.3.3] — Workflow presets + handoff honesty

### Added
- Workflow presets: `fast` (`discover,cockpit,handoff`) and `full` (`discover,static,cockpit,handoff`)
- `--workflow-preset fast|full`, `--fetch-archives`, `--static-limit` on `scout workflow run`
- Token-aware default: `GITHUB_TOKEN`/`GH_TOKEN` present → `full`; otherwise `fast` with warning when `full` requested without token
- Real static workflow stage: shortlist-scoped `inspectCandidateStaticArchive`, per-candidate failure tolerance, re-triage
- Session manifest fields: `workflow_preset_requested`, `workflow_preset_effective`, `static_fetch_archives`
- Handoff `handoff_mode` (`metadata_only` | `static_verified`), preset-aware `recommended_packages` gating
- `has_observed_reward_metadata` alias on reward metadata exports
- Fast-preset cockpit metadata-only banner when static evidence is low
- `beginner-python-ts` preset: `stars:<500` filter
- Self-hosted CI only (removed GitHub-hosted `ci.yml` to avoid cloud runner minutes)
- Runbooks index: `src/scout/runbooks/README.md`

### Changed
- `suggested_commands` use session-relative `--report` paths with optional `cwd`
- `scout test-policy` runs policy test suite instead of stub message
- Docs: accurate CI story, workflow preset tables, policy scope honesty (Scout CLI vs harness)
- Dockerfile label aligned to `0.3.3`
- Probe runbook: argv-inferred registry check wording

### Deferred (0.4.0)
- JSON Schema for `scout_report.json`
- OpenClaw/Slack monitor notifications

## [0.3.2] — Profiles + incremental monitor

### Added
- Presets: `beginner-docs-only`, `beginner-small-repos`, `rewarded-verified-only`
- Seed lists: `beginner-small`, `docs-friendly`; `beginner-python-ts` now uses `beginner-small`
- Profile fields: `require_verified_reward`, `shortlist_verdicts`, `repo_size_filter`
- `scout monitor --skip-known`, `--since`, `--notify` with exit code 1 on actionable events
- `scripts/monitor.ps1` for Task Scheduler
- Incremental enrichment reuse via `knownCandidates` map

## [0.3.1] — Workflow UX

### Added
- `workflow.js` / `session.js` — pipeline orchestration and session manifest
- `scout workflow run --through discover,static,cockpit,handoff`
- `scout workflow resume --session <dir>`
- `scout workflow run --shortlist-limit N`
- `scout inspect --candidate-id <id>`
- Subcommand help: `scout workflow|plan|probe --help`
- Handoff schema 1.1: `recommended_packages`, `suggested_commands`, `schema_version`
- [`AGENTS.md`](AGENTS.md) — handoff-first harness routing
- `test:policy` in `npm run ci`

## [0.3.0] — Performance

### Added
- `github-client.js` — unified GitHub HTTP/GraphQL transport with cache, concurrency, and backoff
- `github-cache.js` — disk cache under `.scout/cache/github/` with ETag support
- `github-graphql.js` — batch GraphQL enrichment with per-candidate REST fallback
- `async-pool.js` — bounded concurrency for candidate enrichment
- `candidate-metadata.js` — shared metadata/reward helpers (breaks import cycles)
- CLI flags: `--no-cache`, `--enrich-mode rest|graphql|auto`
- `scripts/benchmark-discovery.ps1` — local discovery mode comparison
- Env vars: `SCOUT_CACHE_TTL_SEARCH`, `SCOUT_CACHE_TTL_METADATA`, `SCOUT_GITHUB_CONCURRENCY`, `SCOUT_ENRICH_MODE`

## [0.2.0] — Release 3 (R3)

### Fixes (post-audit)
- Honest R3B egress documentation: command-inferred allowlist checks, not packet-level enforcement
- Propagate `discovery_intent` through monitor, inspect, and triage config merge paths
- Rewarded GREEN requires verified reward signal (label or title payout); inferred-only stays YELLOW
- Curated `rewarded-programs` seed list (removed platform meta-repo entries)
- `package.json` and `package-lock.json` version aligned to `0.2.0`
- Docs sync: README prerequisites (`.env`, Docker), expanded `PROJECT_CONTEXT.md` layout/CLI map, Dockerfile version label

### R3.0 — Dual discovery intents + agent-agnostic harness
- Added `discovery_intent` (`beginner` | `rewarded`) on search profiles with backward-compatible default `beginner`
- Presets: `beginner-python-ts`, `rewarded-typescript`
- Reward signal extraction from GitHub labels/title/body (`extractRewardSignals`)
- `rewarded-programs` packaged seed list
- Intent-aware triage with `REWARD_GAP`, `income_summary`, and rewarded scoring
- Intent-specific report/shortlist columns
- Decision cockpit `reward_signal` confidence category
- Agent-agnostic rebrand: `agent_summary.md` primary, `codex_summary.md` compat copy
- Runbooks renamed to `*-runbook.md` with harness headers

### R3A — CLI wiring
- `scout cockpit --report`
- `scout plan install-dry-run` and `scout plan network-design`
- `decision-cockpit-runbook.md`

### R3B — Executable install probes
- `registry_allowlist` network policy in `probe.js`
- `install_probe` command set with R2D approval phrase validation
- Egress logging via `createEgressLogRecord` / `evaluateEgressHost`
- Adversarial tests for egress escape and lifecycle bypass

### R3C — Test probe gating
- `test_probe` requires successful `install_probe` evidence

### R3D — Handoff export
- `scout handoff` and `handoff_package.json` in workflow output
- Includes `discovery_intent` and rewarded payout disclaimer

---

## [0.1.0] — Release 2

### R2A–R2G
- Search profiles, discovery, static inspection, triage, reports
- R2D network design helpers, R2E install dry-run, R2F test design gate, R2G decision cockpit helpers
- Docker readonly probes, policy engine, monitor

### R2H
- Adversarial eval suite (33+ tests)

---

## [0.0.1] — Release 1

- Initial metadata-only Scout CLI
