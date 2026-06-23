import { sleep } from "./async-pool.js";

const DEFAULT_SEARCH_PACE_MS = 4000;
const DEFAULT_SEARCH_MAX_RETRIES = 3;
const DEFAULT_SEARCH_SECONDARY_COOLDOWN_MS = 60_000;
const MAX_SECONDARY_COOLDOWN_MS = 120_000;
const MAX_RETRY_WAIT_MS = 60_000;

export function resolveSearchPaceMs(override = null) {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
    return override;
  }
  const raw = process.env.SCOUT_SEARCH_PACE_MS;
  if (raw === undefined || raw === "") {
    return DEFAULT_SEARCH_PACE_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SEARCH_PACE_MS;
}

export function resolveSearchSecondaryCooldownMs(override = null) {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
    return override;
  }
  const raw = process.env.SCOUT_SEARCH_SECONDARY_COOLDOWN_MS;
  if (raw === undefined || raw === "") {
    return DEFAULT_SEARCH_SECONDARY_COOLDOWN_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SEARCH_SECONDARY_COOLDOWN_MS;
}

export function resolveSearchMaxRetries(override = null) {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
    return Math.floor(override);
  }
  const raw = process.env.SCOUT_SEARCH_MAX_RETRIES;
  if (raw === undefined || raw === "") {
    return DEFAULT_SEARCH_MAX_RETRIES;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_SEARCH_MAX_RETRIES;
}

export function classifySearchError(error) {
  const body = String(error?.body ?? error?.message ?? "").toLowerCase();
  if (error?.status === 429) {
    return "secondary_rate_limit";
  }
  if (error?.status === 403 && body.includes("secondary rate limit")) {
    return "secondary_rate_limit";
  }
  if (error?.rate_limit?.resource === "search" && error?.rate_limit?.remaining === 0) {
    return "primary_rate_limit";
  }
  return "search_failed";
}

export function isRetryableSearchError(error) {
  if (error?.status !== 403 && error?.status !== 429) {
    return false;
  }
  const body = String(error?.body ?? error?.message ?? "").toLowerCase();
  if (body.includes("secondary rate limit")) {
    return true;
  }
  if (error.status === 429) {
    return true;
  }
  if (error.rate_limit?.resource === "search" && error.rate_limit?.remaining === 0) {
    return true;
  }
  return false;
}

export function parseRetryAfterSeconds(headers) {
  const raw = headers?.get?.("retry-after") ?? headers?.get?.("Retry-After");
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function computeSearchRetryDelayMs(attempt, retryAfterSeconds = null) {
  if (retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds)) {
    return Math.min(MAX_RETRY_WAIT_MS, retryAfterSeconds * 1000);
  }
  const exponential = Math.min(MAX_RETRY_WAIT_MS, 1000 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 500);
  return exponential + jitter;
}

export function computeSecondarySessionCooldownMs(
  hitCount,
  secondaryCooldownMs = resolveSearchSecondaryCooldownMs(),
) {
  if (!Number.isFinite(hitCount) || hitCount < 1) {
    return 0;
  }
  const bumped = secondaryCooldownMs * 2 ** (hitCount - 1);
  return Math.min(MAX_SECONDARY_COOLDOWN_MS, bumped);
}

export function createSearchSessionGuard({
  paceMs = resolveSearchPaceMs(),
  secondaryCooldownMs = resolveSearchSecondaryCooldownMs(),
} = {}) {
  let lastPacedAt = 0;
  let cooldownUntil = 0;
  let secondaryHitCount = 0;

  async function paceSearch() {
    const now = Date.now();
    const paceWait =
      paceMs > 0 && lastPacedAt > 0 ? Math.max(0, paceMs - (now - lastPacedAt)) : 0;
    const cooldownWait = Math.max(0, cooldownUntil - now);
    const waitMs = Math.max(paceWait, cooldownWait);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    lastPacedAt = Date.now();
  }

  function onSecondaryLimitHit() {
    secondaryHitCount += 1;
    cooldownUntil = Date.now() + computeSecondarySessionCooldownMs(secondaryHitCount, secondaryCooldownMs);
  }

  return { paceSearch, onSecondaryLimitHit };
}

export function createSearchPacer(paceMs = resolveSearchPaceMs()) {
  const { paceSearch } = createSearchSessionGuard({ paceMs, secondaryCooldownMs: 0 });
  return paceSearch;
}
