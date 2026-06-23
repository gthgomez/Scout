import { assertAllowed } from "./policy.js";

const ALGORA_HOST_PATTERN = /\balgora\.io\b/i;

export function findAlgoraPlatformUrl(candidate) {
  for (const signal of candidate?.reward_signals ?? []) {
    if (signal.kind !== "platform_url") {
      continue;
    }
    const value = String(signal.value ?? "");
    if (signal.platform === "algora" || ALGORA_HOST_PATTERN.test(value)) {
      return value;
    }
  }
  return null;
}

export function parseAlgoraPublicPage(html) {
  const text = String(html ?? "");
  const status =
    text.match(/"status"\s*:\s*"(open|closed|claimed|completed)"/i)?.[1]?.toLowerCase() ??
    text.match(/\bstatus\s*[:>]\s*(open|closed|claimed|completed)\b/i)?.[1]?.toLowerCase() ??
    null;
  const amountMatch =
    text.match(/"amount(?:Usd)?"\s*:\s*(\d+(?:\.\d+)?)/i) ??
    text.match(/\$\s*(\d+(?:\.\d{2})?)/);
  const amount = amountMatch ? Number(amountMatch[1]) : null;
  return {
    status,
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: "USD",
  };
}

export async function applyAlgoraPlatformEnrich({
  candidate,
  policy,
  fetchImpl = globalThis.fetch,
  auditLog = null,
}) {
  if (!candidate) {
    return candidate;
  }
  const url = findAlgoraPlatformUrl(candidate);
  if (!url) {
    return candidate;
  }

  try {
    assertAllowed(policy, "bounty_platform_metadata_read");
  } catch (error) {
    auditLog?.record?.({
      event_type: "ALGORA_ENRICH_SKIPPED",
      detail: error.message,
      candidate_id: candidate.candidate_id,
    });
    return candidate;
  }

  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "text/html,application/json",
        "User-Agent": "Scout/0.6.0 (read-only bounty metadata)",
      },
    });
    if (!response.ok) {
      return candidate;
    }
    const body = await response.text();
    const parsed = parseAlgoraPublicPage(body);
    if (!parsed.status && parsed.amount === null) {
      return candidate;
    }

    const source_observations = [...(candidate.source_observations ?? [])];
    const enriched = {
      ...candidate,
      payout_verified_externally: false,
    };

    if (parsed.status) {
      enriched.platform_status_observed = parsed.status;
      source_observations.push({
        kind: "platform_status",
        value: parsed.status,
        confidence: "INFERRED",
        source_ref: url,
        platform: "algora",
      });
    }
    if (parsed.amount !== null) {
      enriched.platform_amount_observed = parsed.amount;
      source_observations.push({
        kind: "platform_amount",
        value: String(parsed.amount),
        currency: parsed.currency,
        confidence: "INFERRED",
        source_ref: url,
        platform: "algora",
      });
    }

    enriched.source_observations = source_observations;
    auditLog?.record?.({
      event_type: "ALGORA_ENRICH_APPLIED",
      candidate_id: candidate.candidate_id,
      platform_status_observed: enriched.platform_status_observed ?? null,
      platform_amount_observed: enriched.platform_amount_observed ?? null,
    });
    return enriched;
  } catch (error) {
    auditLog?.record?.({
      event_type: "ALGORA_ENRICH_FAILED",
      detail: error.message,
      candidate_id: candidate.candidate_id,
    });
    return candidate;
  }
}
