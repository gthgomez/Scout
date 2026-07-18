import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Canonical claim lifecycle (income funnel):
 * researching → claimed → pr_open → merged → paid | abandoned
 *
 * Aliases accepted on CLI/input: in_progress→claimed, submitted→pr_open, working→claimed
 */
export const CLAIM_STATUSES = Object.freeze([
  "researching",
  "claimed",
  "pr_open",
  "merged",
  "paid",
  "abandoned",
]);

/** Statuses that should be skipped by monitor --skip-known / discovery. */
export const ACTIVE_CLAIM_STATUSES = Object.freeze(["claimed", "pr_open", "merged", "paid"]);

/** Human-friendly aliases → canonical status. */
export const CLAIM_STATUS_ALIASES = Object.freeze({
  in_progress: "claimed",
  working: "claimed",
  submitted: "pr_open",
  pr: "pr_open",
  done: "paid",
  dropped: "abandoned",
});

export function claimsLedgerDir(root = process.cwd()) {
  return join(root, ".scout", "claims");
}

export function claimsLedgerPath(root = process.cwd()) {
  return join(claimsLedgerDir(root), "ledger.json");
}

export function emptyClaimsLedger() {
  return { claims: [] };
}

/**
 * Normalize status input (canonical or alias) to a CLAIM_STATUSES value.
 * @param {string} status
 * @returns {string}
 */
export function normalizeClaimStatus(status) {
  if (typeof status !== "string" || status.trim().length === 0) {
    throw new Error(`claim.status must be one of: ${CLAIM_STATUSES.join(", ")}`);
  }
  const raw = status.trim().toLowerCase();
  const canonical = CLAIM_STATUS_ALIASES[raw] ?? raw;
  if (!CLAIM_STATUSES.includes(canonical)) {
    throw new Error(
      `claim.status must be one of: ${CLAIM_STATUSES.join(", ")} (aliases: ${Object.keys(CLAIM_STATUS_ALIASES).join(", ")})`,
    );
  }
  return canonical;
}

export function issueKeyFromClaim(claim) {
  if (claim.issue_key) {
    return claim.issue_key;
  }
  if (claim.candidate_id) {
    const match = /^SCOUT-(.+)-(\d+)$/.exec(claim.candidate_id);
    if (match) {
      const repo = match[1].replace(/-/g, "/");
      return `${repo}#${match[2]}`;
    }
  }
  if (claim.issue_url) {
    const urlMatch = /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/i.exec(claim.issue_url);
    if (urlMatch) {
      return `${urlMatch[1]}/${urlMatch[2]}#${urlMatch[3]}`;
    }
  }
  return null;
}

export function claimIssueKeys(ledger) {
  const keys = new Set();
  for (const claim of ledger?.claims ?? []) {
    if (!ACTIVE_CLAIM_STATUSES.includes(claim.status)) {
      continue;
    }
    const key = issueKeyFromClaim(claim);
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

function assertClaimRecord(claim) {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
    throw new Error("claim must be an object");
  }
  if (typeof claim.issue_url !== "string" || claim.issue_url.length === 0) {
    throw new Error("claim.issue_url must be a non-empty string");
  }
  normalizeClaimStatus(claim.status);
}

function normalizeOptionalAmount(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error("claim.amount_usd must be a non-negative number when set");
  }
  return num;
}

function normalizeClaim(claim) {
  assertClaimRecord(claim);
  const now = new Date().toISOString();
  const status = normalizeClaimStatus(claim.status);
  const amountUsd = normalizeOptionalAmount(claim.amount_usd);
  return {
    issue_url: claim.issue_url,
    candidate_id: claim.candidate_id ?? null,
    status,
    platform_claim_url: claim.platform_claim_url ?? null,
    pr_url: claim.pr_url ?? null,
    claimed_at: claim.claimed_at ?? now,
    paid_at: claim.paid_at ?? (status === "paid" ? now : null),
    amount_usd: amountUsd,
    amount_currency: claim.amount_currency ?? (amountUsd != null ? "USD" : null),
    notes: claim.notes ?? claim.note ?? "",
    issue_key: issueKeyFromClaim(claim),
  };
}

export async function loadClaimsLedger(root = process.cwd()) {
  try {
    const raw = await readFile(claimsLedgerPath(root), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.claims)) {
      throw new Error("claims ledger must contain a claims array");
    }
    return {
      claims: parsed.claims.map((claim) => normalizeClaim(claim)),
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return emptyClaimsLedger();
    }
    throw error;
  }
}

export async function saveClaimsLedger(ledger, root = process.cwd()) {
  if (!ledger || typeof ledger !== "object" || !Array.isArray(ledger.claims)) {
    throw new Error("ledger must contain a claims array");
  }
  const normalized = {
    claims: ledger.claims.map((claim) => normalizeClaim(claim)),
  };
  const dir = claimsLedgerDir(root);
  await mkdir(dir, { recursive: true });
  await writeFile(claimsLedgerPath(root), JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

export function upsertClaim(ledger, claim) {
  const next = {
    claims: [...(ledger?.claims ?? [])],
  };
  const normalized = normalizeClaim(claim);
  const index = next.claims.findIndex(
    (entry) =>
      entry.issue_url === normalized.issue_url ||
      (normalized.candidate_id && entry.candidate_id === normalized.candidate_id) ||
      (normalized.issue_key && entry.issue_key === normalized.issue_key),
  );
  if (index === -1) {
    next.claims.push(normalized);
  } else {
    next.claims[index] = { ...next.claims[index], ...normalized };
  }
  return next;
}

/**
 * Funnel scorecard from the local claims ledger (income KPIs).
 * @param {{ claims?: object[] }} ledger
 * @returns {object}
 */
export function summarizeClaimsLedger(ledger) {
  const claims = ledger?.claims ?? [];
  const byStatus = Object.fromEntries(CLAIM_STATUSES.map((status) => [status, 0]));
  let paidUsd = 0;
  let paidCount = 0;
  let inFlight = 0;
  for (const claim of claims) {
    const status = claim.status;
    if (byStatus[status] !== undefined) {
      byStatus[status] += 1;
    }
    if (status === "paid") {
      paidCount += 1;
      if (typeof claim.amount_usd === "number") {
        paidUsd += claim.amount_usd;
      }
    }
    if (["researching", "claimed", "pr_open", "merged"].includes(status)) {
      inFlight += 1;
    }
  }
  return {
    generated_at: new Date().toISOString(),
    total_claims: claims.length,
    by_status: byStatus,
    in_flight: inFlight,
    paid_count: paidCount,
    paid_usd_sum: paidUsd,
    active_skip_keys: claimIssueKeys(ledger).size,
  };
}
