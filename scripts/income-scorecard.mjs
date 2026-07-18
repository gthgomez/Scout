#!/usr/bin/env node
/**
 * Weekly income scorecard from claims ledger + optional watch/benchmark artifacts.
 *
 *   node scripts/income-scorecard.mjs
 *   node scripts/income-scorecard.mjs --watch scout_watch_report.json
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIncomeScorecard, writeIncomeScorecard } from "../src/scout/income-ops.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function readArg(argv, name, fallback = null) {
  const idx = argv.indexOf(name);
  if (idx === -1 || idx + 1 >= argv.length) return fallback;
  return argv[idx + 1];
}

async function main(argv) {
  const watch = readArg(argv, "--watch", "scout_watch_report.json");
  const bench = readArg(argv, "--benchmark", ".scout/benchmark-rewarded-hunt.json");
  const scorecard = await buildIncomeScorecard({
    root,
    watchReportPath: resolve(root, watch),
    benchmarkPath: resolve(root, bench),
  });
  const { jsonPath, mdPath } = await writeIncomeScorecard(scorecard, { root });
  console.log(`Income scorecard written to ${mdPath}`);
  console.log(`Machine scorecard written to ${jsonPath}`);
  console.log(
    JSON.stringify(
      {
        total_claims: scorecard.claims.total_claims,
        in_flight: scorecard.claims.in_flight,
        paid_count: scorecard.claims.paid_count,
        paid_usd_sum: scorecard.claims.paid_usd_sum,
        by_status: scorecard.claims.by_status,
      },
      null,
      2,
    ),
  );
  return 0;
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
