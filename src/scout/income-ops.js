/**
 * Income-ops helpers: top actionable candidate selection + webhook payload + scorecard.
 * Policy-safe: no GitHub writes; operates on local report/ledger artifacts only.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadClaimsLedger, summarizeClaimsLedger } from "./claims-ledger.js";

const VERDICT_RANK = Object.freeze({ GREEN: 4, YELLOW: 3, GRAY: 2, RED: 1 });

/**
 * Rank decisions for cash-in action (GREEN first, then YELLOW by ROI / payout).
 * @param {object} report - scout report model
 * @param {{ includeYellow?: boolean, limit?: number }} [options]
 * @returns {object[]} ranked decision rows with candidate fields when available
 */
export function rankActionableDecisions(report, options = {}) {
  const includeYellow = options.includeYellow !== false;
  const limit = options.limit ?? 5;
  const candidatesById = new Map((report?.candidates ?? []).map((c) => [c.candidate_id, c]));
  const allowed = new Set(includeYellow ? ["GREEN", "YELLOW"] : ["GREEN"]);

  const rows = (report?.decisions ?? [])
    .filter((d) => allowed.has(d.verdict))
    .map((decision) => {
      const candidate = candidatesById.get(decision.candidate_id) ?? null;
      const roi =
        decision.roi_score ??
        decision.roi_score_inferred ??
        candidate?.roi_score ??
        candidate?.roi_score_inferred ??
        null;
      const payout =
        decision.estimated_reward_usd ??
        candidate?.estimated_reward_usd ??
        null;
      return {
        candidate_id: decision.candidate_id,
        verdict: decision.verdict,
        score: decision.score ?? null,
        roi_score: typeof roi === "number" ? roi : null,
        estimated_reward_usd: typeof payout === "number" ? payout : null,
        estimated_effort_hours: decision.estimated_effort_hours ?? candidate?.estimated_effort_hours ?? null,
        claim_friction_score: decision.claim_friction_score ?? candidate?.claim_friction_score ?? null,
        human_next_action: decision.human_next_action ?? null,
        issue_url: candidate
          ? `https://github.com/${candidate.repo_owner}/${candidate.repo_name}/issues/${candidate.issue_number}`
          : null,
        repo: candidate ? `${candidate.repo_owner}/${candidate.repo_name}` : null,
        title: candidate?.issue_title ?? candidate?.title ?? null,
        platform_url:
          candidate?.platform_url ??
          (candidate?.reward_signals ?? []).find((s) => s.kind === "platform_url")?.value ??
          null,
        rank_key: rankKey(decision.verdict, roi, payout, decision.score),
      };
    })
    .sort((a, b) => b.rank_key - a.rank_key || String(a.candidate_id).localeCompare(String(b.candidate_id)));

  return rows.slice(0, limit);
}

function rankKey(verdict, roi, payout, score) {
  const v = (VERDICT_RANK[verdict] ?? 0) * 1_000_000;
  const r = (typeof roi === "number" ? roi : 0) * 1_000;
  const p = typeof payout === "number" ? payout : 0;
  const s = typeof score === "number" ? score : 0;
  return v + r + p + s * 0.01;
}

/**
 * Build actionable summary for webhooks / act-top1 from a monitor or discover report.
 */
export function buildIncomeActionSummary(report, options = {}) {
  const top = rankActionableDecisions(report, { includeYellow: options.includeYellow !== false, limit: options.limit ?? 5 });
  const monitorEvents = report?.monitor_events ?? [];
  const newOrImproved = monitorEvents.filter((e) =>
    ["new_candidate", "verdict_improved"].includes(e.change_type),
  );
  return {
    generated_at: new Date().toISOString(),
    profile_id: report?.profile?.profile_id ?? report?.profile_id ?? null,
    discovery_intent: report?.discovery_intent ?? null,
    run_status: report?.run_status ?? null,
    candidate_count: report?.candidates?.length ?? 0,
    decision_counts: countVerdicts(report?.decisions ?? []),
    monitor_actionable_count: newOrImproved.length,
    top_candidates: top,
    top_candidate: top[0] ?? null,
  };
}

function countVerdicts(decisions) {
  const counts = { GREEN: 0, YELLOW: 0, GRAY: 0, RED: 0 };
  for (const d of decisions) {
    if (counts[d.verdict] !== undefined) counts[d.verdict] += 1;
  }
  return counts;
}

/**
 * Webhook JSON body for SCOUT_WEBHOOK_URL (income-ops daily exit 1).
 */
export function buildWebhookPayload({ mode, report, summary }) {
  const action = summary ?? (report ? buildIncomeActionSummary(report) : null);
  const top = action?.top_candidate ?? null;
  return {
    source: "scout-income-ops",
    mode: mode ?? "daily",
    at: new Date().toISOString(),
    actionable: Boolean(top || (action?.monitor_actionable_count ?? 0) > 0),
    run_status: action?.run_status ?? null,
    candidate_count: action?.candidate_count ?? 0,
    decision_counts: action?.decision_counts ?? null,
    monitor_actionable_count: action?.monitor_actionable_count ?? 0,
    top_candidate_id: top?.candidate_id ?? null,
    top_verdict: top?.verdict ?? null,
    top_roi_score: top?.roi_score ?? null,
    top_estimated_reward_usd: top?.estimated_reward_usd ?? null,
    top_issue_url: top?.issue_url ?? null,
    top_platform_url: top?.platform_url ?? null,
    top_title: top?.title ?? null,
    next_step: top
      ? `Verify platform payout, then: node scripts/act-top1.mjs --report <watch.json> --execute`
      : "No GREEN/YELLOW shortlist; try rewarded-explore or re-run after quiet API period",
  };
}

export async function loadReportJson(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

/**
 * Combined weekly income scorecard: claims funnel + optional watch/bench notes.
 */
export async function buildIncomeScorecard(options = {}) {
  const root = options.root ?? process.cwd();
  const ledger = await loadClaimsLedger(root);
  const claims = summarizeClaimsLedger(ledger);
  let lastWatch = null;
  if (options.watchReportPath) {
    try {
      const report = await loadReportJson(options.watchReportPath);
      lastWatch = buildIncomeActionSummary(report);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  let benchmark = null;
  if (options.benchmarkPath) {
    try {
      benchmark = JSON.parse(await readFile(options.benchmarkPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return {
    generated_at: new Date().toISOString(),
    claims,
    last_watch: lastWatch,
    benchmark_summary: benchmark
      ? {
          generated_at: benchmark.generated_at ?? null,
          profile: benchmark.profile ?? null,
          lane: benchmark.lanes?.[0]?.name ?? benchmark.lane_mode ?? null,
          metrics: benchmark.lanes?.[0]?.metrics ?? benchmark.metrics ?? null,
        }
      : null,
  };
}

export function renderIncomeScorecardMarkdown(scorecard) {
  const c = scorecard.claims;
  const lines = [
    "# Scout income scorecard",
    "",
    `Generated: ${scorecard.generated_at}`,
    "",
    "## Claims funnel",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total claims | ${c.total_claims} |`,
    `| In flight | ${c.in_flight} |`,
    `| Paid count | ${c.paid_count} |`,
    `| Paid USD (sum) | ${c.paid_usd_sum} |`,
    `| Active skip keys | ${c.active_skip_keys} |`,
    "",
    "### By status",
    "",
  ];
  for (const [status, count] of Object.entries(c.by_status)) {
    lines.push(`- **${status}**: ${count}`);
  }
  if (scorecard.last_watch?.top_candidate) {
    const t = scorecard.last_watch.top_candidate;
    lines.push("", "## Last watch top pick", "", `- ${t.candidate_id} (${t.verdict})`, `- ${t.issue_url ?? "n/a"}`, `- ROI: ${t.roi_score ?? "n/a"} | payout: ${t.estimated_reward_usd ?? "n/a"}`);
  }
  if (scorecard.benchmark_summary?.metrics) {
    const m = scorecard.benchmark_summary.metrics;
    lines.push(
      "",
      "## Last benchmark (snippet)",
      "",
      `- run_status: ${m.run_status ?? "n/a"}`,
      `- shortlist GREEN/YELLOW: ${m.shortlist_green ?? 0}/${m.shortlist_yellow ?? 0}`,
      `- 403 rate: ${m.collection_error_403_rate ?? "n/a"}`,
      `- seed hits: ${m.seed_queries_with_hits ?? "n/a"}`,
      `- platform URL candidates: ${m.candidates_with_platform_url ?? "n/a"}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export async function writeIncomeScorecard(scorecard, options = {}) {
  const root = options.root ?? process.cwd();
  const dir = join(root, ".scout");
  await mkdir(dir, { recursive: true });
  const jsonPath = options.jsonOut ?? join(dir, "income-scorecard.json");
  const mdPath = options.mdOut ?? join(dir, "income-scorecard.md");
  await writeFile(jsonPath, JSON.stringify(scorecard, null, 2), "utf8");
  await writeFile(mdPath, renderIncomeScorecardMarkdown(scorecard), "utf8");
  return { jsonPath, mdPath };
}
