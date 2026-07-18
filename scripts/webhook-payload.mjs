#!/usr/bin/env node
/** Print SCOUT_WEBHOOK_URL JSON body for a report file. */
import { resolve } from "node:path";
import { buildIncomeActionSummary, buildWebhookPayload, loadReportJson } from "../src/scout/income-ops.js";

const reportPath = process.argv[2];
const mode = process.argv[3] ?? "daily";
if (!reportPath) {
  console.error("Usage: node scripts/webhook-payload.mjs <report.json> [mode]");
  process.exit(2);
}
const report = await loadReportJson(resolve(reportPath));
const summary = buildIncomeActionSummary(report, { includeYellow: true, limit: 5 });
process.stdout.write(JSON.stringify(buildWebhookPayload({ mode, report, summary })));
