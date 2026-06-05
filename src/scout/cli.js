#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultPolicy } from "./policy.js";
import { DEFAULT_QUERIES, discoverCandidates } from "./discovery.js";
import { AuditLog } from "./audit-log.js";
import { diffReports, loadMonitorSnapshot, saveMonitorSnapshot } from "./monitor.js";
import {
  createSearchProfile,
  loadSearchProfile,
  queriesFromProfile,
  saveSearchProfile,
} from "./profiles.js";
import { loadTrustedSeedLists } from "./seed-lists.js";
import { triageCandidates } from "./triage.js";
import { createReportModel, exportShortlist, explainCandidate, renderMarkdownReport } from "./report.js";
import {
  evidenceFromStaticInspection,
  inspectCandidateStaticArchive,
  inspectCandidateStaticManifest,
} from "./static-inspection.js";
import { DEFAULT_SANDBOX_POLICY, DockerSandboxRunner, probeDoctor, runProbe } from "./probe.js";
import { validateReportModel } from "./validators.js";

async function main(argv) {
  const [command, ...args] = argv;
  if (!command || ["-h", "--help", "help"].includes(command)) {
    printHelp();
    return 0;
  }

  if (command === "run") {
    return runSafe(args);
  }
  if (command === "discover") {
    return discover(args);
  }
  if (command === "inspect") {
    return inspect(args);
  }
  if (command === "validate-report") {
    return validateReportCommand(args);
  }
  if (command === "explain") {
    return explainCommand(args);
  }
  if (command === "export-shortlist") {
    return exportShortlistCommand(args);
  }
  if (command === "profile") {
    return profile(args);
  }
  if (command === "monitor") {
    return monitor(args);
  }
  if (command === "workflow") {
    return workflow(args);
  }
  if (command === "probe") {
    return probeCommand(args);
  }
  if (command === "test-policy") {
    console.log("Policy tests are available through npm test.");
    return 0;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function validateReportCommand(args) {
  const reportPath = readArg(args, "--report", args[0]);
  if (!reportPath) {
    throw new Error("validate-report requires --report <report-path>.");
  }
  const report = await loadReport(reportPath);
  validateDecisionReferences(report);
  const decisionCoverage = ensureDecisionCoverage(report);
  if (decisionCoverage.missing > 0) {
    throw new Error(
      `Report validation failed: ${decisionCoverage.missing} candidate(s) lack triage decisions.`,
    );
  }
  console.log(`Report validation passed for ${reportPath}.`);
  console.log(`Candidates: ${report.candidates.length}`);
  console.log(`Decisions: ${report.decisions.length}`);
  console.log(`Evidence records: ${report.evidence.length}`);
  console.log(`Decision coverage: ${decisionCoverage.covered}/${decisionCoverage.totalCandidates}`);
  return 0;
}

async function explainCommand(args) {
  const candidateId = readArg(args, "--candidate-id", null);
  const reportPath = readArg(args, "--report", args.find((arg) => !arg.startsWith("--") && arg !== candidateId));
  if (!candidateId) {
    throw new Error("explain requires --candidate-id <candidate_id>.");
  }
  if (!reportPath) {
    throw new Error("explain requires --report <report-path>.");
  }
  const report = await loadReport(reportPath);
  validateDecisionReferences(report);
  const output = explainCandidate(report, candidateId);
  console.log(output);
  return 0;
}

async function exportShortlistCommand(args) {
  const reportPath = readArg(args, "--report", args[0]);
  if (!reportPath) {
    throw new Error("export-shortlist requires --report <report-path>.");
  }
  const out = readArg(args, "--out", "scout_shortlist.md");
  const limit = readLimit(readArg(args, "--limit", "50"));
  const report = await loadReport(reportPath);
  validateDecisionReferences(report);
  const rendered = exportShortlist(report, { limit });
  await writeFile(out, rendered, "utf8");
  console.log(`Scout shortlist written to ${out}`);
  return 0;
}

async function probeCommand(args) {
  if (args[0] === "doctor") {
    const image = readArg(args, "--image", DEFAULT_SANDBOX_POLICY.image);
    const jsonOut = readArg(args, "--json-out", null);
    const diagnosis = await probeDoctor({ image });
    if (jsonOut) {
      await writeFile(jsonOut, JSON.stringify(diagnosis, null, 2), "utf8");
    }
    console.log(`Scout probe doctor: ${diagnosis.status}`);
    for (const check of diagnosis.checks) {
      console.log(`- ${check.name}: ${check.status} (${check.reason})`);
    }
    if (jsonOut) console.log(`Scout probe doctor JSON written to ${jsonOut}`);
    return 0;
  }

  const reportPath = readArg(args, "--report", null);
  const candidateId = readArg(args, "--candidate-id", null);
  const approvalId = readArg(args, "--approval-id", null);
  const out = readArg(args, "--out", "scout_probe_report.md");
  const jsonOut = readArg(args, "--json-out", "scout_probe_report.json");
  const network = readArg(args, "--network", "none");
  const commandSet = readArg(args, "--command-set", "readonly");
  const maxDurationSeconds = readLimit(readArg(args, "--max-duration-seconds", "60"));

  if (!reportPath) {
    throw new Error("probe requires --report <report.json>.");
  }
  if (!candidateId) {
    throw new Error("probe requires --candidate-id <candidate_id>.");
  }
  if (!approvalId) {
    throw new Error("probe requires --approval-id <approval_id>.");
  }

  const report = await loadReport(reportPath);
  const probed = await runProbe({
    report,
    candidateId,
    approvalId,
    network,
    commandSet,
    maxDurationSeconds,
    runner: new DockerSandboxRunner(),
    outputDir: join(".scout", "probe", candidateId),
  });
  validateReportModel(probed);
  await writeReportOutputs(probed, out, jsonOut);
  console.log(`Scout probe report written to ${out}`);
  if (jsonOut) console.log(`Scout probe machine report written to ${jsonOut}`);
  return 0;
}

async function runSafe(args) {
  const limit = Number(readArg(args, "--limit", "50"));
  const out = readArg(args, "--out", "scout_report.md");
  const jsonOut = readArg(args, "--json-out", null);
  const policy = defaultPolicy("metadata_only");
  const report = await buildReport({ policy, limit });
  await writeReportOutputs(report, out, jsonOut);
  console.log(`Scout metadata-only report written to ${out}`);
  if (jsonOut) console.log(`Scout machine report written to ${jsonOut}`);
  return 0;
}

async function discover(args) {
  const mode = readArg(args, "--mode", "metadata_only");
  const limit = Number(readArg(args, "--limit", "50"));
  const out = readArg(args, "--out", "scout_report.md");
  const jsonOut = readArg(args, "--json-out", null);
  const policy = defaultPolicy(mode);
  const report = await buildReport({ policy, limit });
  await writeReportOutputs(report, out, jsonOut);
  console.log(`Scout discovery report written to ${out}`);
  if (jsonOut) console.log(`Scout machine report written to ${jsonOut}`);
  return 0;
}

async function inspect(args) {
  const policy = defaultPolicy("static_inspection");
  const out = readArg(args, "--out", "scout_report.md");
  const jsonOut = readArg(args, "--json-out", null);
  const reportPath = readArg(args, "--report", null);
  const manifestPath = readArg(args, "--manifest", null);
  const fetchArchives = readFlag(args, "--fetch-archives");
  const auditLog = new AuditLog();

  let report;
  if (!reportPath || (!manifestPath && !fetchArchives)) {
    throw new Error("inspect requires --report <scout_report.json> and either --manifest <manifest.json> or --fetch-archives.");
  } else {
    const baseReport = await loadReport(reportPath);
    const manifestModel = manifestPath ? await loadJson(manifestPath) : null;
    const inspectedCandidates = [];
    for (const candidate of baseReport.candidates) {
      if (fetchArchives) {
        inspectedCandidates.push(await inspectCandidateStaticArchive({ policy, candidate }));
      } else {
        inspectedCandidates.push(
          inspectCandidateStaticManifest({
            policy,
            candidate,
            manifest: selectManifestForCandidate(manifestModel, candidate.candidate_id),
          }),
        );
      }
    }
    const staticEvidence = inspectedCandidates.flatMap(evidenceFromStaticInspection);
    const decisions = triageCandidates(inspectedCandidates, {
      profile: {
        profile_id: baseReport.triage_config?.profile_id,
        threshold_overrides: baseReport.triage_config?.threshold_overrides ?? {},
      },
    });
    if (fetchArchives) {
      auditLog.record({
        operation: "static_source_fetch",
        mode: policy.mode,
        decision: "allowed",
        reason: `Static archive fetch completed for ${inspectedCandidates.length} candidates.`,
      });
      auditLog.record({
        operation: "archive_download",
        mode: policy.mode,
        decision: "allowed",
        reason: `Static archive download completed for ${inspectedCandidates.length} candidates.`,
      });
    }
    auditLog.record({
      operation: "static_file_read",
      mode: policy.mode,
      decision: "allowed",
      reason: fetchArchives
        ? `Static archive inspection completed for ${inspectedCandidates.length} candidates.`
        : `Static manifest inspection completed for ${inspectedCandidates.length} candidates.`,
    });
    report = createReportModel({
      run_status: baseReport.run_status,
      collection_errors: baseReport.collection_errors,
      candidates: inspectedCandidates,
      decisions,
      evidence: [...baseReport.evidence, ...staticEvidence],
      audit_events: [...baseReport.audit_events, ...auditLog.all()],
      monitor_events: baseReport.monitor_events,
      command_attempts: baseReport.command_attempts,
      triage_config: baseReport.triage_config,
    });
  }
  await writeReportOutputs(report, out, jsonOut);
  console.log(`Scout static-inspection report written to ${out}`);
  if (jsonOut) console.log(`Scout machine report written to ${jsonOut}`);
  return 0;
}

async function profile(args) {
  const action = args[0];
  if (action === "create") {
    const name = args[1] ?? "default";
    const languages = splitArg(readArg(args, "--languages", "Python,TypeScript"));
    const labels = splitArg(readArg(args, "--labels", "good first issue,help wanted,documentation"));
    const excludeOrgs = splitArg(readArg(args, "--exclude-orgs", ""));
    const excludeRepos = splitArg(readArg(args, "--exclude-repos", ""));
    const trustedSeedLists = splitArg(readArg(args, "--trusted-seed-lists", ""));
    const thresholdOverrides = readJsonArg(args, "--threshold-overrides", {});
    const maxCandidates = readLimit(readArg(args, "--max-candidates", "50"));
    const profileModel = createSearchProfile({
      name,
      languages,
      labels,
      exclude_orgs: excludeOrgs,
      exclude_repos: excludeRepos,
      trusted_seed_lists: trustedSeedLists,
      threshold_overrides: thresholdOverrides,
      max_candidates: maxCandidates,
    });
    const saved = await saveSearchProfile(profileModel);
    console.log(JSON.stringify({ ...saved.profile, path: saved.path }, null, 2));
    return 0;
  }
  if (action === "run") {
    const name = args[1] ?? "default";
    const out = readArg(args, "--out", "scout_report.md");
    const jsonOut = readArg(args, "--json-out", null);
    const profileModel = await loadProfileOrDefault(name);
    const policy = defaultPolicy("metadata_only");
    const report = await buildProfileReport({ policy, profile: profileModel });
    await writeReportOutputs(report, out, jsonOut);
    console.log(`Scout profile report written to ${out}`);
    if (jsonOut) console.log(`Scout machine report written to ${jsonOut}`);
    return 0;
  }
  throw new Error("profile command requires create or run");
}

async function monitor(args) {
  const profileName = readArg(args, "--profile", "default");
  const out = readArg(args, "--out", "scout_watch_report.md");
  const jsonOut = readArg(args, "--json-out", null);
  const profileModel = await loadProfileOrDefault(profileName);
  const policy = defaultPolicy("metadata_only");
  const previous = await loadMonitorSnapshot(profileName);
  const current = await buildProfileReport({ policy, profile: profileModel });
  const monitorEvents = diffReports(previous?.decisions ?? [], current.decisions, profileModel.profile_id);
  const report = createReportModel({
    run_status: current.run_status,
    collection_errors: current.collection_errors,
    candidates: current.candidates,
    decisions: current.decisions,
    evidence: current.evidence,
    audit_events: current.audit_events,
    monitor_events: monitorEvents,
    command_attempts: current.command_attempts,
    triage_config: current.triage_config,
  });
  await saveMonitorSnapshot(profileName, report);
  await writeReportOutputs(report, out, jsonOut);
  console.log(`Scout monitor report written to ${out}`);
  if (jsonOut) console.log(`Scout machine report written to ${jsonOut}`);
  return 0;
}

async function workflow(args) {
  const action = args[0];
  if (action !== "run") {
    throw new Error("workflow command requires run");
  }
  const profileName = readArg(args, "--profile", "default");
  const outDir = readArg(args, "--out-dir", "scout_session");
  const profileModel = await loadProfileOrDefault(profileName);
  const policy = defaultPolicy("metadata_only");
  const report = await buildProfileReport({ policy, profile: profileModel });
  const shortlist = exportShortlist(report, { limit: 10 });
  const summary = renderCodexSummary(report);
  const nextActions = createNextActions(report);

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "scout_session.json"), JSON.stringify({ profile: profileModel, generated_at: new Date().toISOString() }, null, 2), "utf8");
  await writeFile(join(outDir, "scout_report.md"), renderMarkdownReport(report), "utf8");
  await writeFile(join(outDir, "scout_report.json"), JSON.stringify(report, null, 2), "utf8");
  await writeFile(join(outDir, "scout_shortlist.md"), shortlist, "utf8");
  await writeFile(join(outDir, "codex_summary.md"), summary, "utf8");
  await writeFile(join(outDir, "next_actions.json"), JSON.stringify(nextActions, null, 2), "utf8");
  console.log(`Scout workflow artifacts written to ${outDir}`);
  return 0;
}

async function buildReport({ policy, limit, queries, profile = null }) {
  const auditLog = new AuditLog();
  let candidates = [];
  const evidence = [];
  const collectionErrors = [];
  const activeQueries = queries ?? DEFAULT_QUERIES;
  try {
    candidates = await discoverCandidates({ policy, limit, queries: activeQueries, auditLog, collectionErrors, profile });
  } catch (error) {
    if (error.code === "SCOUT_POLICY_DENIED") throw error;
    auditLog.record({
      operation: "github_search_read",
      mode: policy.mode,
      decision: "failed",
      reason: error.message,
    });
    collectionErrors.push({
      error_id: `collection-discovery-error-${Date.now()}`,
      operation: "github_search_read",
      query: null,
      message: error.message,
      observed_at: new Date().toISOString(),
    });
    evidence.push({
      evidence_id: `evidence-discovery-error-${Date.now()}`,
      candidate_id: "DISCOVERY",
      source_type: "UNKNOWN",
      source_ref: "Scout discovery",
      observed_at: new Date().toISOString(),
      trust_level: "UNKNOWN",
      claim: `Discovery failed before candidate collection: ${error.message}`,
      supports: "partial report warning",
    });
    candidates = [];
  }
  appendCandidateMetadataEvidence(candidates, evidence);
  const decisions = triageCandidates(candidates, { profile });
  const runStatus = determineRunStatus({ candidates, collectionErrors, queryCount: activeQueries.length || 1 });
  return createReportModel({
    run_status: runStatus,
    collection_errors: collectionErrors,
    candidates,
    decisions,
    evidence,
    audit_events: auditLog.all(),
    profile,
  });
}

async function buildProfileReport({ policy, profile }) {
  const trustedSeedLists = await loadTrustedSeedLists(profile.trusted_seed_lists ?? []);
  return buildReport({
    policy,
    limit: profile.max_candidates,
    queries: queriesFromProfile(profile, { trustedSeedLists }),
    profile,
  });
}

function appendCandidateMetadataEvidence(candidates, evidence) {
  for (const candidate of candidates) {
    evidence.push({
      evidence_id: `evidence-metadata-${candidate.candidate_id}`,
      candidate_id: candidate.candidate_id,
      source_type: "GITHUB_API",
      source_ref: candidate.issue_url,
      observed_at: new Date().toISOString(),
      trust_level: candidate.collection_status === "OBSERVED" ? "OBSERVED" : "UNKNOWN",
      claim: `GitHub metadata collected for ${candidate.repo_owner}/${candidate.repo_name}#${candidate.issue_number} with collection_status=${candidate.collection_status}.`,
      supports: "candidate metadata and triage input",
    });
  }
}

async function writeReportOutputs(report, out, jsonOut = null) {
  if (out.toLowerCase().endsWith(".json")) {
    await writeFile(out, JSON.stringify(report, null, 2), "utf8");
  } else {
    await writeFile(out, renderMarkdownReport(report), "utf8");
  }
  if (jsonOut) {
    await writeFile(jsonOut, JSON.stringify(report, null, 2), "utf8");
  }
}

function readArg(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function readFlag(args, name) {
  return args.includes(name);
}

function readJsonArg(args, name, fallback) {
  const raw = readArg(args, name, null);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message}`);
  }
}

async function loadReport(reportPath) {
  const report = await loadJson(reportPath);
  return validateReportModel(normalizeReportModel(report));
}

function normalizeReportModel(report) {
  if (!report || typeof report !== "object") {
    return report;
  }
  return {
    ...report,
    run_status: report.run_status ?? "complete",
    collection_errors: Array.isArray(report.collection_errors) ? report.collection_errors : [],
    sandbox_runs: Array.isArray(report.sandbox_runs) ? report.sandbox_runs : [],
    probe_config: report.probe_config ?? null,
    probe_status: report.probe_status ?? "not_requested",
  };
}

async function loadJson(path) {
  const raw = await readFile(path, "utf8");
  let report;
  try {
    report = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Unable to parse JSON at ${path}: ${error.message}`);
  }
  return report;
}

function ensureDecisionCoverage(report) {
  const decisionById = new Map(report.decisions.map((decision) => [decision.candidate_id, decision]));
  const covered = report.candidates.reduce((count, candidate) => count + (decisionById.has(candidate.candidate_id) ? 1 : 0), 0);
  return {
    covered,
    totalCandidates: report.candidates.length,
    missing: Math.max(0, report.candidates.length - covered),
  };
}

function validateDecisionReferences(report) {
  const candidateIds = new Set(report.candidates.map((candidate) => candidate.candidate_id));
  const orphanedDecisionIds = report.decisions
    .map((decision) => decision.candidate_id)
    .filter((candidateId) => !candidateIds.has(candidateId));
  if (orphanedDecisionIds.length > 0) {
    throw new Error(`Report contains decisions without matching candidates: ${orphanedDecisionIds.join(", ")}`);
  }
}

function readLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--limit must be a positive integer. Got: ${value}`);
  }
  return parsed;
}

function splitArg(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

async function loadProfileOrDefault(name) {
  try {
    return await loadSearchProfile(name);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    const profileModel = createSearchProfile({ name });
    await saveSearchProfile(profileModel);
    return profileModel;
  }
}

function selectManifestForCandidate(manifestModel, candidateId) {
  if (Array.isArray(manifestModel)) {
    return manifestModel;
  }
  if (Array.isArray(manifestModel?.[candidateId])) {
    return manifestModel[candidateId];
  }
  if (Array.isArray(manifestModel?.candidates?.[candidateId])) {
    return manifestModel.candidates[candidateId];
  }
  if (Array.isArray(manifestModel?.manifests?.[candidateId])) {
    return manifestModel.manifests[candidateId];
  }
  return null;
}

function determineRunStatus({ candidates, collectionErrors, queryCount }) {
  if (collectionErrors.length === 0) return "complete";
  if (candidates.length === 0 && collectionErrors.length >= queryCount) return "failed";
  return "partial";
}

function renderCodexSummary(report) {
  const recommended = report.decisions.filter((decision) => ["GREEN", "YELLOW"].includes(decision.verdict));
  const unknown = report.decisions.filter((decision) => decision.verdict === "GRAY");
  const dropped = report.decisions.filter((decision) => decision.verdict === "RED");
  return [
    "# Codex Scout Summary",
    "",
    `Run status: ${report.run_status}`,
    `Recommended: ${recommended.length}`,
    `Unknown: ${unknown.length}`,
    `Dropped: ${dropped.length}`,
    "",
    "No clone, install, repo script, dynamic probe, or GitHub write action was attempted.",
    "",
    "## Next Safe Step",
    recommended.length > 0
      ? "Review the shortlist manually and choose candidates for static inspection or direct human review."
      : "Review collection errors and broaden or adjust the profile before rerunning Scout.",
  ].join("\n");
}

function createNextActions(report) {
  return report.decisions.map((decision) => ({
    candidate_id: decision.candidate_id,
    action: decision.verdict === "RED" ? "drop_candidate" : decision.verdict === "GRAY" ? "review_candidate" : "manual_claim_possible",
    reason: decision.risk_summary,
    requires_human: true,
  }));
}

function printHelp() {
  console.log(`Scout Release 2

Codex-facing backend commands:
  scout run --safe --limit 50 --out scout_report.md
  scout discover --mode metadata_only --limit 50 --out scout_report.md --json-out scout_report.json
  scout inspect --report scout_report.json --manifest manifest.json --out scout_static_report.md --json-out scout_static_report.json
  scout inspect --report scout_report.json --fetch-archives --out scout_static_report.md --json-out scout_static_report.json
  scout validate-report --report scout_report.json
  scout explain --candidate-id SCOUT-0001 --report scout_report.json
  scout export-shortlist --report scout_report.json --limit 25 --out scout_shortlist.md
  scout profile create beginner-python-ts --languages Python,TypeScript --trusted-seed-lists starter-pack --threshold-overrides '{"green_min_score":40}'
  scout profile run beginner-python-ts --out scout_report.md
  scout monitor --profile beginner-python-ts --out scout_watch_report.md
  scout workflow run --profile beginner-python-ts --out-dir scout_session
  scout probe doctor --json-out scout_probe_doctor.json
  scout probe --report scout_static_report.json --candidate-id SCOUT-0001 --approval-id APPROVAL-123 --network none --command-set readonly --out scout_probe_report.md --json-out scout_probe_report.json
  scout test-policy

Top-level --help is available; subcommand-specific --help is not implemented.
Release 2 probe is approval-bound, Docker-backed, no-network, readonly, one candidate at a time, and uses local Docker images only.
Scout still denies clone, installs, repo scripts, GitHub writes, issue claiming, forks, branches, PRs, and issue-to-patch workflows.`);
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
