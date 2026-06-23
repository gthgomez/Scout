import { extractPlatformUrls } from "./reward-signals.js";

const CONTRIBUTING_REWARD_KEYWORDS = Object.freeze([
  { pattern: /\bpaid contribution\b/i, value: "paid contribution" },
  { pattern: /\bbounty\b/i, value: "bounty" },
  { pattern: /\balgora\b/i, value: "algora" },
  { pattern: /\breward\b/i, value: "reward" },
  { pattern: /\bissuehunt\b/i, value: "issuehunt" },
  { pattern: /\balgora\.io\b/i, value: "algora.io" },
]);

export function isContributingGuidePath(filePath) {
  const normalized = String(filePath ?? "").replace(/\\/g, "/");
  const baseName = normalized.split("/").pop() ?? normalized;
  return /^contributing(?:\.[a-z0-9._-]+)?$/i.test(baseName);
}

export function scanContributingRewardProgram(text, filePath = "CONTRIBUTING.md") {
  const source = String(text ?? "");
  if (!source.trim()) {
    return [];
  }

  const observations = [];
  const seen = new Set();

  for (const { pattern, value } of CONTRIBUTING_REWARD_KEYWORDS) {
    if (!pattern.test(source)) {
      continue;
    }
    const key = `contributing_reward_program:${value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    observations.push({
      kind: "contributing_reward_program",
      value,
      confidence: "INFERRED",
      source_ref: filePath,
    });
  }

  for (const { value: url, platform } of extractPlatformUrls(source)) {
    if (platform !== "algora") {
      continue;
    }
    const key = `reward_signal:platform_url:${url.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    observations.push({
      kind: "reward_signal",
      value: `platform_url:${url}`,
      confidence: "OBSERVED",
      source_ref: filePath,
      platform,
    });
  }

  return observations;
}
