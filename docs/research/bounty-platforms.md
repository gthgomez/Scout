# Bounty platforms survey — Scout integration research

> **Status:** Research snapshot (2026-06-23) — partially superseded: Algora live check implemented since 0.6.0; `rewarded-programs-algora` expanded to 10 repos (0.6.1); Opire integrated into handoff schema 1.2.

Research for expanding reward discovery beyond GitHub label/title heuristics. Scout currently detects **Algora** and **IssueHunt** URLs in [`reward-signals.js`](../../src/scout/reward-signals.js).

## Platform comparison

| Platform | Discovery today | Public API | Auth | Claim / payout flow | Scout P1 idea | Scout P2 idea |
|----------|-----------------|------------|------|---------------------|---------------|---------------|
| **Algora** | `algora` label, `algora.io/bounties/*` URLs | GraphQL/console (no official public REST doc in repo) | Org API keys via console | Maintainer funds → dev claims on console → PR merged → payout | Extend URL patterns; seed list `rewarded-programs-algora` | API enrich for live bounty status + amount |
| **IssueHunt** | `issuehunt.io` URL regex | Limited; mostly web UI | OAuth for hunters | Back issue → PR → payout on merge | Add `issuehunt` label to `seed_reward_labels` | URL-only; defer API |
| **Opire** | Not integrated | Unknown | Unknown | Per-issue bounties on opire.dev | Research GitHub label `opire` | Low priority until API clarity |
| **Polar.sh** | Not integrated | REST API exists | API key | Subscriptions/tips, not classic issue bounties | Tag as **non-issue-bounty** | Out of scope for issue hunt |
| **GitHub Sponsors** | Not integrated | GitHub API | GitHub token | Sponsorship, not per-issue | Out of scope | — |
| **Gitcoin / Bountycoin** | Not integrated | Web3 contracts | Wallet | On-chain bounties | Out of scope (different threat model) | — |
| **thanks.dev / Open Collective** | Not integrated | Varies | Varies | Recurring tips | Tag as **non-issue-bounty** | — |
| **BountyHub / similar** | Appears in spam repos | — | — | Often spam farms | Keep [`bounty-spam.js`](../../src/scout/bounty-spam.js) heuristics | — |

## Algora (highest priority)

### How programs appear on GitHub

- Issues labeled `algora` (and sometimes `bounty`, `reward`)
- Body links: `https://algora.io/bounties/...`, `https://console.algora.io/...`
- Programs listed at algora.io (public browse)

### Scout integration status

| Capability | Status |
|------------|--------|
| URL detection | Implemented |
| Label detection | In `seed_reward_labels` |
| Seed list | `rewarded-programs-algora` (7 repos) |
| Live status check | **Not implemented** |
| Payout amount from platform | **Not implemented** (GitHub inference only) |

### Go/no-go: Algora API enrich

| Factor | Assessment |
|--------|------------|
| Value | High — verified open amount + status |
| Risk | Medium — ToS, API key storage, rate limits |
| Policy | Read-only metadata OK in Scout; no claim automation |
| Recommendation | **Spike after P0 pacing** — 1-day prototype: given issue URL, fetch bounty status if API permits |

## IssueHunt

### Scout integration status

| Capability | Status |
|------------|--------|
| URL regex | Implemented (`issuehunt.io/r/issues`, `/issues`) |
| Label | Not in default `seed_reward_labels` |

### Recommendation

- **P1:** Add `issuehunt` to broad query: `is:issue state:open label:issuehunt no:assignee`
- **P1:** Add IssueHunt URL platform in CONTRIBUTING scan (already scans `issuehunt` keyword)
- **Defer API** until clear documented hunter API exists

## Opire

Emerging platform; some OSS repos use Opire badges in README. No Scout patterns today.

**Research action:** Sample 10 Opire-linked GitHub issues; check for consistent label/body patterns before adding regex.

## Non-issue-bounty platforms (exclude from hunt presets)

These improve maintainer income but do not map to Scout's issue-centric workflow:

- Polar.sh, GitHub Sponsors, thanks.dev, Open Collective, Ko-fi

Document in profile preset docs so agents do not expect `rewarded-hunt` to surface them.

## Seed list maintenance criteria

For [`rewarded-programs.json`](../../src/scout/seed-lists/rewarded-programs.json) and [`rewarded-programs-algora.json`](../../src/scout/seed-lists/rewarded-programs-algora.json):

| Criterion | Required |
|-----------|----------|
| Active bounty program (Algora console or labeled issues in last 90d) | Yes |
| Maintained repo (push within 90d) | Yes |
| Overlap between lists | No |
| Min typical payout | Research target ≥$25 for broad GREEN alignment |
| Stack relevance | Optional profile filter later |

### Suggested quarterly audit process

1. Run `rewarded-hunt` benchmark with pacing (post-P0)
2. For each seed repo, count open `bounty`/`algora` labeled issues
3. Compare against Algora public program list
4. Propose add/remove PRs to seed JSON

## Platform URL patterns to add (P1)

Extend `PLATFORM_URL_PATTERNS` in [`reward-signals.js`](../../src/scout/reward-signals.js):

```js
// Proposed additions (research only — implement in follow-up PR)
{ platform: "opire", regex: /opire\.dev\/[^\s)\]"'<>]+/gi },
```

## References

- Scout modules: [`reward-signals.js`](../../src/scout/reward-signals.js), [`contributing-reward-scan.js`](../../src/scout/contributing-reward-scan.js)
- Audit: [`scout-bounty-audit-2026-06-23.md`](scout-bounty-audit-2026-06-23.md)
