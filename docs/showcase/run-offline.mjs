// Reproducible, fixture-only showcase. Run from the repository root.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { discoverCandidates } from "../../src/scout/discovery.js";
import { defaultPolicy } from "../../src/scout/policy.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = mkdtempSync(join(tmpdir(), "scout-showcase-"));
// Any accidental use of real fetch fails before making a network request.
globalThis.fetch = async () => { throw new Error("Showcase forbids network requests"); };
const report = JSON.parse(readFileSync(join(root, "src/scout/__tests__/fixtures/report-model.json"))).validReport;
const sample = report.candidates[0];
const query = sample.discovered_by_query;
let fixtureRequests = 0;
const candidates = await discoverCandidates({
  policy: defaultPolicy(), queries: [query], limit: 1, enrich: false,
  cacheEnabled: false,
  fetchImpl: async (url) => {
    assert.equal(new URL(url).pathname, "/search/issues");
    fixtureRequests += 1;
    return new Response(JSON.stringify({ total_count: 1, items: [{
      repository_url: `https://api.github.com/repos/${sample.repo_owner}/${sample.repo_name}`,
      number: sample.issue_number, title: sample.issue_title,
      html_url: sample.issue_url, state: "open", labels: [], assignees: [],
    }] }), { status: 200, headers: { "content-type": "application/json" } });
  },
});
assert.equal(candidates.length, 1);
assert.equal(fixtureRequests, 1);
console.log("SCOUT / OFFLINE FIXTURE DEMO");
console.log("Synthetic acme/tooling data; no live GitHub search or payout evidence.\n");
console.log("[1] Actual discovery mapper, injected local search response");
console.log(JSON.stringify(candidates.map(({ candidate_id, issue_title, collection_status }) =>
  ({ candidate_id, issue_title, collection_status })), null, 2));

// Review the existing unit-test report, including its seeded GREEN decision.
// This is separate from discovery above: no live triage/static verification is claimed.
const reportPath = join(out, "fixture-report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));
function cli(args) {
  console.log(`$ node src/scout/cli.js ${args.join(" ").replaceAll(out, "<output>")}`);
  const result = spawnSync(process.execPath, ["src/scout/cli.js", ...args], {
    cwd: root, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  console.log(result.stdout.trim().replaceAll(out, "<output>"));
}
console.log("\n[2] Validate the saved unit-test report (seeded decision)");
cli(["validate-report", "--report", reportPath]);
console.log("\n[3] Export the decision cockpit and agent handoff");
cli(["cockpit", "--report", reportPath, "--out", join(out, "cockpit.md"), "--json-out", join(out, "cockpit.json")]);
cli(["handoff", "--report", reportPath, "--json-out", join(out, "handoff_package.json")]);
const handoff = JSON.parse(readFileSync(join(out, "handoff_package.json")));
assert.equal(handoff.handoff_mode, "metadata_only");
assert.equal(handoff.schema_version, "1.1");
assert.ok(handoff.packages[0].denied_actions.includes("github_write"));
console.log("\n[4] Read the real exported handoff (selected fields)");
console.log(JSON.stringify({
  schema_version: handoff.schema_version,
  handoff_mode: handoff.handoff_mode,
  handoff_mode_reason: handoff.handoff_mode_reason,
  recommended_packages: handoff.recommended_packages,
  denied_actions: handoff.packages[0].denied_actions,
}, null, 2));
console.log("\nNo archives, installs, probes, claims, contacts, or GitHub writes.");
console.log(`Artifacts: ${out}`);
