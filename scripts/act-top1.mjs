#!/usr/bin/env node
/**
 * Act on the top ROI GREEN/YELLOW candidate from a Scout report (usually monitor watch JSON).
 *
 * Usage:
 *   node scripts/act-top1.mjs --report scout_watch_report.json
 *   node scripts/act-top1.mjs --report scout_watch_report.json --execute
 *   node scripts/act-top1.mjs --report scout_watch_report.json --include-yellow --dry-run
 *
 * --execute runs: scout workflow run --profile <profile> --workflow-preset full --out-dir <dir>
 * Always writes .scout/act-top1.json with the selected pick for the human gate.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildIncomeActionSummary,
  loadReportJson,
} from "../src/scout/income-ops.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function readArg(argv, name, fallback = null) {
  const idx = argv.indexOf(name);
  if (idx === -1 || idx + 1 >= argv.length) return fallback;
  return argv[idx + 1];
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function printHelp() {
  console.log(`act-top1 — pick top cash-in candidate and optionally run full workflow

Usage:
  node scripts/act-top1.mjs --report <scout_report.json> [--execute] [--profile rewarded-cash-in]
  node scripts/act-top1.mjs --report <path> --dry-run
  node scripts/act-top1.mjs --report <path> --green-only

Options:
  --report <path>     Monitor or discover JSON report (required)
  --profile <id>      Workflow profile (default: rewarded-cash-in)
  --out-dir <dir>     Session dir for --execute (default: scout_session_act)
  --execute           Run full workflow after selecting top pick
  --dry-run           Print pick only (default if --execute omitted)
  --green-only        Ignore YELLOW shortlist rows
  --include-yellow    Include YELLOW (default)
`);
}

async function main(argv) {
  if (argv.includes("-h") || argv.includes("--help") || argv.length === 0) {
    printHelp();
    return 0;
  }
  const reportPath = readArg(argv, "--report", null);
  if (!reportPath) {
    console.error("act-top1 requires --report <scout_report.json>");
    return 2;
  }
  const profile = readArg(argv, "--profile", "rewarded-cash-in");
  const outDir = readArg(argv, "--out-dir", "scout_session_act");
  const execute = hasFlag(argv, "--execute");
  const greenOnly = hasFlag(argv, "--green-only");
  const includeYellow = greenOnly ? false : true;

  const report = await loadReportJson(resolve(root, reportPath));
  const summary = buildIncomeActionSummary(report, { includeYellow, limit: 5 });
  const pick = summary.top_candidate;

  const artifactDir = join(root, ".scout");
  await mkdir(artifactDir, { recursive: true });
  const actPath = join(artifactDir, "act-top1.json");
  const actPayload = {
    generated_at: new Date().toISOString(),
    report_path: reportPath,
    profile,
    out_dir: outDir,
    execute,
    summary,
    human_gate: pick
      ? [
          "1. Open platform_url / issue and confirm bounty still OPEN",
          "2. Confirm amount and stack fit",
          "3. scout claims add --issue-url ... --status researching",
          "4. Start coding agent from handoff_package.json after workflow",
        ]
      : ["No GREEN/YELLOW pick — run rewarded-explore or wait for monitor exit 1"],
  };
  await writeFile(actPath, JSON.stringify(actPayload, null, 2), "utf8");

  if (!pick) {
    console.log("act-top1: no GREEN/YELLOW candidate in report.");
    console.log(`Wrote ${actPath}`);
    return 1;
  }

  console.log("act-top1 pick:");
  console.log(`  candidate_id: ${pick.candidate_id}`);
  console.log(`  verdict:      ${pick.verdict}`);
  console.log(`  issue:        ${pick.issue_url ?? "n/a"}`);
  console.log(`  platform:     ${pick.platform_url ?? "n/a"}`);
  console.log(`  roi:          ${pick.roi_score ?? "n/a"}`);
  console.log(`  payout_usd:   ${pick.estimated_reward_usd ?? "n/a"}`);
  console.log(`  title:        ${pick.title ?? "n/a"}`);
  console.log(`Wrote ${actPath}`);

  if (!execute) {
    console.log("Dry-run only. Re-run with --execute to start full workflow.");
    return 0;
  }

  console.log(`Executing workflow: profile=${profile} out-dir=${outDir}`);
  const code = await runNode(
    [join(root, "src/scout/cli.js"), "workflow", "run", "--profile", profile, "--workflow-preset", "full", "--out-dir", outDir],
    root,
  );
  if (code !== 0) {
    console.error(`workflow run exited ${code}`);
    return code;
  }
  console.log(`Session ready: ${outDir}/handoff_package.json`);
  console.log("Next: verify platform payout, then claims add, then coding agent.");
  return 0;
}

function runNode(args, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, args, { cwd, stdio: "inherit" });
    child.on("exit", (code) => resolvePromise(code ?? 1));
    child.on("error", (error) => {
      console.error(error.message);
      resolvePromise(1);
    });
  });
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error.message);
    process.exitCode = 1;
  },
);
