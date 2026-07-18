/**
 * Rewarded-hunt discovery benchmark — writes .scout/benchmark-rewarded-hunt.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseLaneArg() {
  const idx = process.argv.indexOf("--lane");
  if (idx === -1) {
    return "nocache";
  }
  const value = process.argv[idx + 1];
  if (!["nocache", "cached", "both"].includes(value)) {
    console.error("--lane must be nocache, cached, or both");
    process.exit(1);
  }
  return value;
}

async function loadEnv() {
  try {
    const raw = await readFile(join(root, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch {
    // optional
  }
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, ["src/scout/cli.js", ...args], {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr, elapsed_ms: Date.now() - started });
    });
    child.on("error", reject);
  });
}

function summarizeReport(report, queryCount, broadQueryCount) {
  const audit = report.audit_events ?? [];
  const searchEvents = audit.filter((e) => e.operation === "github_search_read");
  const searchObserved = searchEvents.filter((e) => e.decision === "observed");
  const searchFailed = searchEvents.filter((e) => e.decision === "failed");
  const backoffEvents = audit.filter((e) => e.operation === "rate_limit_backoff");
  const collectionErrors = report.collection_errors ?? [];
  const errors403 = collectionErrors.filter((e) => String(e.message).includes("403"));
  const decisions = report.decisions ?? [];
  const verdicts = Object.fromEntries(
    ["GREEN", "YELLOW", "GRAY", "RED"].map((v) => [v, decisions.filter((d) => d.verdict === v).length]),
  );
  const candidates = report.candidates ?? [];
  const candidateById = new Map(candidates.map((c) => [c.candidate_id, c]));
  const withVerifiedReward = candidates.filter((c) => c.has_verified_reward_signal).length;
  const withPlatformUrl = candidates.filter((c) =>
    (c.reward_signals ?? []).some((s) => s.kind === "platform_url"),
  ).length;
  const discoveredQueries = [...new Set(candidates.map((c) => c.discovered_by_query).filter(Boolean))];
  const includeQueries = report.profile?.include_queries ?? [];
  const broadExpected = broadQueryCount ?? includeQueries.length;
  const queryStats = report.discovery_query_stats ?? [];
  const seedQueriesWithHits = queryStats.filter(
    (stat) =>
      (stat.kind === "trusted_seed_list" || stat.kind === "trusted_seed_body") && (stat.items_returned ?? 0) > 0,
  ).length;
  const platformQueriesWithHits = queryStats.filter(
    (stat) => stat.kind === "broad" && (stat.items_returned ?? 0) > 0 && /algora|issuehunt|opire\.dev|in:title/i.test(stat.query ?? ""),
  ).length;

  const greenDecisions = decisions.filter((d) => d.verdict === "GREEN");
  const spamFarmGreen = greenDecisions.filter((d) => {
    const c = candidateById.get(d.candidate_id);
    if (!c) return false;
    const repo = `${c.repo_owner}/${c.repo_name}`.toLowerCase();
    return /rustchain|bounty-forge|zeroeye/i.test(repo);
  }).length;
  const greenFromTrustedOrPlatform = greenDecisions.filter((d) => {
    const c = candidateById.get(d.candidate_id);
    if (!c) return false;
    const trusted = (c.source_observations ?? []).some(
      (o) => o.kind === "trusted_seed_list" || o.kind === "trusted_seed_body",
    );
    const platform = (c.reward_signals ?? []).some((s) => s.kind === "platform_url");
    return trusted || platform;
  }).length;
  const greenFromTrustedOrPlatformPct =
    greenDecisions.length === 0 ? 0 : Number((greenFromTrustedOrPlatform / greenDecisions.length).toFixed(3));

  return {
    run_status: report.run_status,
    elapsed_profile_field: report.generated_at,
    query_count_expected: queryCount,
    search_audit_observed: searchObserved.length,
    search_audit_failed: searchFailed.length,
    rate_limit_backoff_events: backoffEvents.length,
    collection_error_count: collectionErrors.length,
    collection_error_403_count: errors403.length,
    collection_error_403_rate:
      collectionErrors.length === 0 ? 0 : Number((errors403.length / collectionErrors.length).toFixed(3)),
    candidate_count: candidates.length,
    candidates_with_verified_reward: withVerifiedReward,
    candidates_with_platform_url: withPlatformUrl,
    shortlist_green: verdicts.GREEN,
    shortlist_yellow: verdicts.YELLOW,
    shortlist_gray: verdicts.GRAY,
    shortlist_red: verdicts.RED,
    broad_queries_executed: includeQueries.filter((q) => discoveredQueries.includes(q)).length,
    broad_queries_expected: broadExpected,
    discovered_by_query_counts: Object.fromEntries(
      [...discoveredQueries].map((q) => [q, candidates.filter((c) => c.discovered_by_query === q).length]),
    ),
    failed_queries: collectionErrors.map((e) => ({ query: e.query, message: e.message })),
    spam_farm_green_count: spamFarmGreen,
    green_from_trusted_or_platform_count: greenFromTrustedOrPlatform,
    green_from_trusted_or_platform_pct: greenFromTrustedOrPlatformPct,
    seed_queries_with_hits: seedQueriesWithHits,
    platform_queries_with_hits: platformQueriesWithHits,
  };
}

async function countQueries() {
  const { createSearchProfile, queriesFromProfile } = await import("../src/scout/profiles.js");
  const { loadTrustedSeedLists } = await import("../src/scout/seed-lists.js");
  const profile = createSearchProfile({ name: "rewarded-hunt" });
  const lists = await loadTrustedSeedLists(profile.trusted_seed_lists ?? []);
  return {
    queryCount: queriesFromProfile(profile, { trustedSeedLists: lists }).length,
    profile,
    broadQueryCount: (profile.include_queries ?? []).length,
  };
}

async function runLane(name, cacheFlag) {
  const jsonOut = join(".scout", `bench_rewarded_hunt_${name}.json`);
  const mdOut = join(".scout", `bench_rewarded_hunt_${name}.md`);
  const args = ["profile", "run", "rewarded-hunt", "--out", mdOut, "--json-out", jsonOut];
  if (cacheFlag === false) args.push("--no-cache");
  const result = await runCli(args);
  let report = null;
  try {
    report = JSON.parse(await readFile(join(root, jsonOut), "utf8"));
  } catch {
    report = null;
  }
  return { name, cache: cacheFlag, cli_exit_code: result.code, elapsed_ms: result.elapsed_ms, report };
}

await loadEnv();
await mkdir(join(root, ".scout"), { recursive: true });

const laneMode = parseLaneArg();
const { queryCount, broadQueryCount } = await countQueries();
const hasToken = Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);

const lanes = [];
if (hasToken) {
  if (laneMode === "nocache" || laneMode === "both") {
    lanes.push(await runLane("nocache", false));
  }
  if (laneMode === "cached" || laneMode === "both") {
    lanes.push(await runLane("cached", true));
  }
} else {
  lanes.push({ name: "skipped", cache: null, cli_exit_code: 0, elapsed_ms: 0, report: null, skip_reason: "no GITHUB_TOKEN" });
}

const benchmark = {
  generated_at: new Date().toISOString(),
  profile: "rewarded-hunt",
  lane_mode: laneMode,
  query_count: queryCount,
  has_github_token: hasToken,
  targets: {
    max_queries: 25,
    max_403_rate: 0,
    min_shortlist_green_yellow: 3,
    broad_queries_executed_pct: 1,
    max_spam_farm_green: 0,
    min_green_from_trusted_or_platform_pct: 0.8,
    min_seed_queries_with_hits: 2,
    min_platform_query_hits: 1,
  },
  lanes: lanes.map((lane) => ({
    name: lane.name,
    cache: lane.cache,
    cli_exit_code: lane.cli_exit_code,
    elapsed_ms: lane.elapsed_ms,
    skip_reason: lane.skip_reason ?? null,
    metrics: lane.report ? summarizeReport(lane.report, queryCount, broadQueryCount) : null,
  })),
};

const outPath = join(root, ".scout", "benchmark-rewarded-hunt.json");
await writeFile(outPath, JSON.stringify(benchmark, null, 2), "utf8");
console.log(JSON.stringify(benchmark, null, 2));
console.log(`Wrote ${outPath}`);
