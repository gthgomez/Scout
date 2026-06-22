# Changelog

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
- GitHub-hosted Linux CI: `.github/workflows/ci.yml`
- Runbooks index: `src/scout/runbooks/README.md`

### Changed
- `suggested_commands` use session-relative `--report` paths with optional `cwd`
- `scout test-policy` runs policy test suite instead of stub message
- Docs: accurate CI story, workflow preset tables, policy scope honesty (Scout CLI vs harness)
- Dockerfile label aligned to `0.3.3`
- Probe runbook: argv-inferred registry check wording

### Deferred (0.4.0)
- `codex_summary.md` removal
- JSON Schema for `handoff_package.json` / `scout_report.json`

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
