const ALGORA_BOUNTY_URL_PATTERN = /algora\.io\/bounties\/([^/?#\s]+)/i;

export function parseAlgoraBountySlug(url) {
  const match = String(url ?? "").match(ALGORA_BOUNTY_URL_PATTERN);
  return match?.[1] ?? null;
}

export function parseAlgoraApiResponse(body) {
  const payload = typeof body === "string" ? safeJsonParse(body) : body;
  if (!payload || typeof payload !== "object") {
    return { status: null, amount: null, currency: "USD" };
  }

  const bounty = payload.bounty ?? payload.data?.bounty ?? payload.data ?? payload;
  const status = String(bounty.status ?? bounty.state ?? "").toLowerCase() || null;
  const rawAmount = bounty.amountUsd ?? bounty.amount_usd ?? bounty.amount;
  const amount = Number(rawAmount);
  return {
    status,
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: "USD",
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function fetchAlgoraApiMetadata({
  url,
  apiKey = process.env.ALGORA_API_KEY ?? process.env.SCOUT_ALGORA_API_KEY ?? null,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = process.env.ALGORA_API_BASE_URL ?? "https://api.algora.io",
}) {
  if (!apiKey) {
    return null;
  }
  const slug = parseAlgoraBountySlug(url);
  if (!slug) {
    return null;
  }

  const endpoint = `${apiBaseUrl.replace(/\/$/, "")}/v1/bounties/${encodeURIComponent(slug)}`;
  const response = await fetchImpl(endpoint, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "Scout/0.6.2 (read-only bounty metadata)",
    },
  });
  if (!response.ok) {
    return null;
  }
  const body = await response.text();
  const parsed = parseAlgoraApiResponse(body);
  if (!parsed.status && parsed.amount === null) {
    return null;
  }
  return { ...parsed, source_ref: endpoint, source_kind: "algora_api" };
}
