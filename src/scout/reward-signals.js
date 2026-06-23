const TITLE_CONTEXT_KEYWORDS = ["bounty", "reward", "paid", "algora", "💰"];
const BODY_REWARD_KEYWORDS = ["bounty", "reward", "algora", "paid", "usdc", "usdt", "payout"];
const BOUNTY_LABEL_PATTERNS = ["bounty", "reward", "paid", "algora", "💰"];
const KEYWORD_WINDOW = 80;
const LOW_BODY_AMOUNT_THRESHOLD = 25;

const USD_AMOUNT_PATTERNS = [
  /\$\s*(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/gi,
  /(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)\s*usd\b/gi,
];

const CRYPTO_AMOUNT_PATTERNS = [
  { currency: "RTC", regex: /\[BOUNTY:\s*(\d+(?:\.\d+)?)\s*RTC\]/gi },
  { currency: "RTC", regex: /(\d{1,6}(?:,\d{3})*(?:\.\d+)?)\s*RTC\b/gi },
  { currency: "USDC", regex: /(\d{1,6}(?:,\d{3})*(?:\.\d+)?)\s*USDC\b/gi },
  { currency: "USDT", regex: /(\d{1,6}(?:,\d{3})*(?:\.\d+)?)\s*USDT\b/gi },
];

export const REWARD_CURRENCIES = Object.freeze(["USD", "RTC", "USDC", "USDT", "UNKNOWN"]);

const PLATFORM_URL_PATTERNS = [
  {
    platform: "algora",
    regex: /(?:https?:\/\/)?www\.algora\.io\/bounties\/[^\s)\]"'<>]+/gi,
  },
  {
    platform: "algora",
    regex: /(?:https?:\/\/)?(?<!(?:[\w-]+\.))algora\.io\/bounties\/[^\s)\]"'<>]+/gi,
  },
  {
    platform: "algora",
    regex: /(?:https?:\/\/)?console\.algora\.io\/[^\s)\]"'<>]+/gi,
  },
  {
    platform: "issuehunt",
    regex: /(?:https?:\/\/)?(?:www\.)?issuehunt\.io\/r\/issues\/[^\s)\]"'<>]+/gi,
  },
  {
    platform: "issuehunt",
    regex: /(?:https?:\/\/)?(?:www\.)?issuehunt\.io\/issues\/[^\s)\]"'<>]+/gi,
  },
  {
    platform: "opire",
    regex: /(?:https?:\/\/)?(?:www\.)?opire\.dev\/[^\s)\]"'<>]+/gi,
  },
];

export function extractPlatformUrls(text) {
  const source = String(text ?? "");
  if (!source) return [];

  const urls = [];
  const seen = new Set();

  for (const { platform, regex } of PLATFORM_URL_PATTERNS) {
    regex.lastIndex = 0;
    let match = regex.exec(source);
    while (match) {
      let value = match[0];
      if (!/^https?:\/\//i.test(value)) {
        value = `https://${value}`;
      }
      const key = `${platform}:${value.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        urls.push({ value, platform });
      }
      match = regex.exec(source);
    }
  }

  return urls;
}

function findUsdAmountMatches(text) {
  const matches = [];
  for (const pattern of USD_AMOUNT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const parsed = Number(String(match[1]).replaceAll(",", ""));
      if (Number.isFinite(parsed) && parsed > 0) {
        matches.push({ amount: parsed, index: match.index, currency: "USD" });
      }
    }
  }
  return matches;
}

function findCryptoAmountMatches(text) {
  const matches = [];
  for (const { currency, regex } of CRYPTO_AMOUNT_PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const parsed = Number(String(match[1]).replaceAll(",", ""));
      if (Number.isFinite(parsed) && parsed > 0) {
        matches.push({ amount: parsed, index: match.index, currency });
      }
    }
  }
  return matches;
}

function formatAmountValue(amount, currency) {
  if (currency === "USD") return `$${amount}`;
  return `${amount} ${currency}`;
}

function textIncludesKeyword(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function isNearKeyword(text, amountIndex, keywords, window = KEYWORD_WINDOW) {
  const lower = text.toLowerCase();
  const start = Math.max(0, amountIndex - window);
  const end = Math.min(text.length, amountIndex + window);
  const slice = lower.slice(start, end);
  return keywords.some((keyword) => slice.includes(keyword.toLowerCase()));
}

function isNearPlatformUrl(body, amountIndex, platformUrls, window = KEYWORD_WINDOW) {
  const lowerBody = body.toLowerCase();
  for (const entry of platformUrls) {
    const url = String(entry.value ?? entry);
    const idx = lowerBody.indexOf(url.toLowerCase());
    if (idx < 0) continue;
    const urlEnd = idx + url.length;
    const distance =
      amountIndex < idx ? idx - amountIndex : amountIndex > urlEnd ? amountIndex - urlEnd : 0;
    if (distance <= window) return true;
  }
  return false;
}

function hasBountyLabelSignal(labelSignals = []) {
  return labelSignals.some((signal) =>
    BOUNTY_LABEL_PATTERNS.some((pattern) => String(signal.value ?? "").includes(pattern)),
  );
}

export function parseRewardAmount(title, body, context = {}) {
  const titleText = String(title ?? "");
  const bodyText = String(body ?? "");
  const labelSignals = context.labelSignals ?? [];
  const platformUrls = context.platformUrls ?? [];
  const hasBountyLabel = context.hasBountyLabel ?? hasBountyLabelSignal(labelSignals);
  const hasPlatformUrl = context.hasPlatformUrl ?? platformUrls.length > 0;
  const titleHasContext =
    textIncludesKeyword(titleText, TITLE_CONTEXT_KEYWORDS) || hasBountyLabel || hasPlatformUrl;

  const candidates = [];

  for (const { amount } of findUsdAmountMatches(titleText)) {
    if (!titleHasContext) continue;
    candidates.push({
      amount,
      currency: "USD",
      value: formatAmountValue(amount, "USD"),
      confidence: "OBSERVED",
      source_ref: "issue_title",
    });
  }

  for (const { amount, index } of findUsdAmountMatches(bodyText)) {
    if (!isNearKeyword(bodyText, index, BODY_REWARD_KEYWORDS)) continue;

    if (amount < LOW_BODY_AMOUNT_THRESHOLD && !hasBountyLabel && !hasPlatformUrl) {
      continue;
    }

    const nearPlatformUrl = isNearPlatformUrl(bodyText, index, platformUrls);
    candidates.push({
      amount,
      currency: "USD",
      value: formatAmountValue(amount, "USD"),
      confidence: nearPlatformUrl ? "OBSERVED" : "INFERRED",
      source_ref: "issue_body",
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.amount - a.amount);
  const best = candidates[0];
  return {
    amount: best.amount,
    currency: best.currency,
    value: best.value,
    confidence: best.confidence,
    source_ref: best.source_ref,
  };
}

export function parseCryptoRewardAmount(title, body, context = {}) {
  const titleText = String(title ?? "");
  const bodyText = String(body ?? "");
  const labelSignals = context.labelSignals ?? [];
  const platformUrls = context.platformUrls ?? [];
  const hasBountyLabel = context.hasBountyLabel ?? hasBountyLabelSignal(labelSignals);
  const hasPlatformUrl = context.hasPlatformUrl ?? platformUrls.length > 0;
  const titleHasContext =
    textIncludesKeyword(titleText, TITLE_CONTEXT_KEYWORDS) || hasBountyLabel || hasPlatformUrl;

  const candidates = [];

  for (const { amount, currency } of findCryptoAmountMatches(titleText)) {
    if (!titleHasContext) continue;
    candidates.push({
      amount,
      currency,
      value: formatAmountValue(amount, currency),
      confidence: "OBSERVED",
      source_ref: "issue_title",
    });
  }

  for (const { amount, index, currency } of findCryptoAmountMatches(bodyText)) {
    if (!isNearKeyword(bodyText, index, BODY_REWARD_KEYWORDS)) continue;

    if (amount < LOW_BODY_AMOUNT_THRESHOLD && !hasBountyLabel && !hasPlatformUrl) {
      continue;
    }

    const nearPlatformUrl = isNearPlatformUrl(bodyText, index, platformUrls);
    candidates.push({
      amount,
      currency,
      value: formatAmountValue(amount, currency),
      confidence: nearPlatformUrl ? "OBSERVED" : "INFERRED",
      source_ref: "issue_body",
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.amount - a.amount);
  const best = candidates[0];
  return {
    amount: best.amount,
    currency: best.currency,
    value: best.value,
    confidence: best.confidence,
    source_ref: best.source_ref,
  };
}

export function extractRewardSignals(candidate, issueBody = "") {
  const title = String(candidate.issue_title ?? "");
  const body = String(issueBody ?? "");
  const labels = (candidate.labels ?? []).map((label) => String(label).toLowerCase());
  const combined = `${title}\n${body}`.toLowerCase();
  const signals = [];
  const labelPatterns = [
    { kind: "label", pattern: "bounty", confidence: "OBSERVED" },
    { kind: "label", pattern: "reward", confidence: "OBSERVED" },
    { kind: "label", pattern: "paid", confidence: "OBSERVED" },
    { kind: "label", pattern: "sponsor", confidence: "OBSERVED" },
    { kind: "label", pattern: "algora", confidence: "OBSERVED" },
    { kind: "label", pattern: "gitcoin", confidence: "INFERRED" },
    { kind: "label", pattern: "issuehunt", confidence: "INFERRED" },
    { kind: "label", pattern: "💰", confidence: "OBSERVED" },
  ];

  for (const label of labels) {
    for (const { kind, pattern, confidence } of labelPatterns) {
      if (label.includes(pattern)) {
        signals.push({
          kind,
          value: label,
          confidence,
          source_ref: `label:${label}`,
        });
      }
    }
  }

  for (const [text, sourceRef] of [
    [title, "issue_title"],
    [body, "issue_body"],
  ]) {
    for (const { value, platform } of extractPlatformUrls(text)) {
      signals.push({
        kind: "platform_url",
        value,
        confidence: "OBSERVED",
        source_ref: sourceRef,
        platform,
      });
    }
  }

  const bodyKeywords = ["bounty", "reward", "paid", "sponsor", "algora", "gitcoin", "issuehunt"];
  for (const keyword of bodyKeywords) {
    if (combined.includes(keyword)) {
      signals.push({
        kind: "keyword",
        value: keyword,
        confidence: title.toLowerCase().includes(keyword) ? "OBSERVED" : "INFERRED",
        source_ref: title.toLowerCase().includes(keyword) ? "issue_title" : "issue_body",
      });
    }
  }

  const labelSignals = signals.filter((signal) => signal.kind === "label");
  const platformUrls = [
    ...extractPlatformUrls(title),
    ...extractPlatformUrls(body),
  ];
  const parsedAmount = parseRewardAmount(title, body, {
    labelSignals,
    platformUrls,
    hasBountyLabel: hasBountyLabelSignal(labelSignals),
    hasPlatformUrl: platformUrls.length > 0,
  });
  const parsedCryptoAmount = parseCryptoRewardAmount(title, body, {
    labelSignals,
    platformUrls,
    hasBountyLabel: hasBountyLabelSignal(labelSignals),
    hasPlatformUrl: platformUrls.length > 0,
  });

  let estimatedRewardUsd = null;
  let estimatedRewardAmount = null;
  let rewardCurrency = null;

  if (parsedAmount) {
    estimatedRewardUsd = parsedAmount.amount;
    estimatedRewardAmount = parsedAmount.amount;
    rewardCurrency = "USD";
    signals.push({
      kind: "amount",
      value: parsedAmount.value,
      confidence: parsedAmount.confidence,
      source_ref: parsedAmount.source_ref,
      currency: "USD",
    });
  } else if (parsedCryptoAmount) {
    estimatedRewardAmount = parsedCryptoAmount.amount;
    rewardCurrency = parsedCryptoAmount.currency;
    signals.push({
      kind: "amount",
      value: parsedCryptoAmount.value,
      confidence: parsedCryptoAmount.confidence,
      source_ref: parsedCryptoAmount.source_ref,
      currency: parsedCryptoAmount.currency,
    });
  }

  const deduped = dedupeRewardSignals(signals);
  const hasVerified = deduped.some(
    (signal) => signal.confidence === "OBSERVED" && ["label", "amount", "platform_url"].includes(signal.kind),
  );
  const hasInferred = deduped.some((signal) => signal.confidence === "INFERRED" || signal.kind === "keyword");

  return {
    reward_signals: deduped,
    has_verified_reward_signal: hasVerified,
    has_observed_reward_metadata: hasVerified,
    has_inferred_reward_signal: hasInferred,
    estimated_reward_usd: estimatedRewardUsd,
    estimated_reward_amount: estimatedRewardAmount,
    reward_currency: rewardCurrency,
    source_observations: deduped.map((signal) => ({
      kind: "reward_signal",
      value: `${signal.kind}:${signal.value}`,
      confidence: signal.confidence,
      source_ref: signal.source_ref,
    })),
  };
}

function dedupeRewardSignals(signals) {
  const seen = new Set();
  return signals.filter((signal) => {
    const key = `${signal.kind}:${signal.value}:${signal.source_ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export { dedupeRewardSignals };
