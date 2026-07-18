# Algora API spike — research notes

Status: **implemented as optional spike** in `algora-api-enrich.js` with HTML scrape fallback in `algora-enrich.js`.

## Current Scout path

- URL detection in `reward-signals.js`
- Optional `algora_platform_enrich: true` on `rewarded-cash-in`
- If `ALGORA_API_KEY` (or `SCOUT_ALGORA_API_KEY`) is set, Scout tries `GET {ALGORA_API_BASE_URL}/v1/bounties/{slug}` first
- On API miss/failure, falls back to public page scrape (`INFERRED`)
- Scout **never** sets `payout_verified_externally: true`

## Configuration

```env
ALGORA_API_KEY=your_key
# ALGORA_API_BASE_URL=https://api.algora.io
```

## Validation

- Unit tests: `src/scout/__tests__/algora-api-enrich.test.js`
- Live validation requires org API key + ToS confirmation
- Gate production reliance on benchmark `candidates_with_platform_url >= 1`

## References

- [Bounty platforms survey](bounty-platforms.md)
- `src/scout/algora-api-enrich.js`
- `src/scout/algora-enrich.js`
