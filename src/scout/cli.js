#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Minimal .env loader — no dependencies needed.
// Loads KEY=VALUE pairs from <project>/.env into process.env (skips existing vars).
async function loadEnv(projectRoot) {
  const envPath = resolve(projectRoot, ".env");
  try {
    const raw = await readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = val.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env file is optional — silent skip if missing or unreadable
  }
}
import { defaultPolicy } from "./policy.js";
import { DEFAULT_QUERIES, discoverCandidates } from "./discovery.js";
import { AuditLog } from "./audit-log.js";
import { diffReports, loadMonitorSnapshot, saveMonitorSnapshot, buildKnownCandidatesMap, summarizeMonitorEvents, monitorHasActionableEvents } from "./monitor.js";
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
import {
  createDecisionCockpitModel,
  exportHandoffPackages,
  renderDecisionCockpitSection,
} from "./decision-cockpit.js";
import {
  createInstallProbeDryRunPlan,
  renderInstallProbeDryRunSection,
} from "./install-probe-dry-run.js";
import {
  renderNetworkApprovalText,
  renderNetworkDesignReportSection,
  validateNetworkExpansionContract,
} from "./network-design.js";
import { resolveDiscoveryIntent } from "./profiles.js";
import { executeWorkflow, loadSessionManifest } from "./workflow.js";

async function main(argv) {
  const [command, ...args] = argv;
  if (command === "workflow" && args.includes("--help")) {
    printWorkflowHelp();
    return 0;
  }
  if (command === "plan" && args.includes("--help")) {
    printPlanHelp();
    return 0;
  }
  if (command === "probe" && args.includes("--help")) {
    printProbeHelp();
    return 0;
  }
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
  if (command === "cockpit") {
    return cockpitCommand(args);
  }
  if (command === "plan") {
    return planCommand(args);
  }
  if (command === "handoff") {
    return handoffCommand(args);
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
  const contractPath = readArg(args, "--contract", null);

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
  const networkContract = contractPath ? await loadJson(contractPath) : null;
  const probed = await runProbe({
    report,
    candidateId,
    approvalId,
    network,
    commandSet,
    maxDurationSeconds,
    networkContract,
    runner: new DockerSandboxRunner(),
    outputDir: join(".scout", "probe", candidateId),
  });
  validateReportModel(probed);
  await writeReportOutputs(probed, out, jsonOut);
  console.log(`Scout probe report written to ${out}`);
  if (jsonOut) console.log(`Scout probe machine report written to ${jsonOut}`);
  return 0;
}

async function cockpitCommand(args) {
  const reportPath = readArg(args, "--report", args[0]);
  const out = readArg(args, "--out", "scout_cockpit.md");
  const jsonOut = readArg(args, "--json-out", "scout_cockpit.json");
  if (!reportPath) {
    throw new Error("cockpit requires --report <report.json>.");
  }
  const report = await loadReport(reportPath);
  const model = createDecisionCockpitModel(report);
  await writeFile(out, renderDecisionCockpitSection(model), "utf8");
  await writeFile(jsonOut, JSON.stringify(model, null, 2), "utf8");
  console.log(`Scout decision cockpit written to ${out}`);
  if (jsonOut) console.log(`Scout decision cockpit JSON written to ${jsonOut}`);
  return 0;
}

async function planCommand(args) {
  const action = args[0];
  const reportPath = readArg(args, "--report", null);
  const candidateId = readArg(args, "--candidate-id", null);
  const contractPath = readArg(args, "--contract", null);
  const out = readArg(args, "--out", null);
  const jsonOut = readArg(args, "--json-out", null);
  if (!reportPath) {
    throw new Error("plan requires --report <report.json>.");
  }
  if (!candidateId) {
    throw new Error("plan requires --candidate-id <candidate_id>.");
  }
  const report = await loadReport(reportPath);
  const candidate = report.candidates.find((item) => item.candidate_id === candidateId);
  if (!candidate) {
    throw new Error(`Unknown candidate id: ${candidateId}`);
  }

  if (action === "install-dry-run") {
    if (!contractPath) {
      throw new Error("plan install-dry-run requires --contract <network-contract.json>.");
    }
    const contract = validateNetworkExpansionContract(await loadJson(contractPath));
    const plan = createInstallProbeDryRunPlan(report, candidateId, contract);
    const rendered = renderInstallProbeDryRunSection(plan);
    const outputPath = out ?? "scout_install_dry_run.md";
    await writeFile(outputPath, rendered, "utf8");
    if (jsonOut) await writeFile(jsonOut, JSON.stringify(plan, null, 2), "utf8");
    console.log(`Scout install dry-run plan written to ${outputPath}`);
    return 0;
  }

  if (action === "network-design") {
    const contract = validateNetworkExpansionContract(
      contractPath
        ? await loadJson(contractPath)
        : buildDefaultNetworkContract(candidate),
    );
    const rendered = [
      renderNetworkDesignReportSection(contract),
      "",
      renderNetworkApprovalText(contract),
    ].join("\n");
    const outputPath = out ?? "scout_network_design.md";
    await writeFile(outputPath, rendered, "utf8");
    if (jsonOut) await writeFile(jsonOut, JSON.stringify(contract, null, 2), "utf8");
    console.log(`Scout network design written to ${outputPath}`);
    return 0;
  }

  throw new Error("plan command requires install-dry-run or network-design");
}

async function handoffCommand(args) {
  const reportPath = readArg(args, "--report", args[0]);
  const jsonOut = readArg(args, "--json-out", "handoff_package.json");
  if (!reportPath) {
    throw new Error("handoff requires --report <report.json>.");
  }
  const report = await loadReport(reportPath);
  const handoff = exportHandoffPackages(report, { shortlistLimit: readLimit(readArg(args, "--shortlist-limit", "10")) });
  await writeFile(jsonOut, JSON.stringify(handoff, null, 2), "utf8");
  console.log(`Scout handoff package written to ${jsonOut}`);
  return 0;
}

function buildDefaultNetworkContract(candidate) {
  const repo = `${candidate.repo_owner}/${candidate.repo_name}`;
  const registryHosts = ["registry.npmjs.org", "pypi.org", "files.pythonhosted.org"];
  const fields = {
    contract_id: `r3d-${candidate.candidate_id}`,
    candidate_id: candidate.candidate_id,
    repo,
    issue: candidate.issue_url,
    network_policy: "registry_allowlist",
    registry_hosts: registryHosts,
    command_set: "install_probe_design",
    lifecycle_policy: "scripts_disabled",
    timeout_seconds: 120,
    artifact_retention: "retain_stdout_stderr_7_days",
  };
  return {
    ...fields,
    approval_phrase: [
      "APPROVE SCOUT R2D",
      fields.candidate_id,
      fields.repo,
      fields.issue,
      fields.network_policy,
      ...registryHosts,
      fields.command_set,
      fields.lifecycle_policy,
      String(fields.timeout_seconds),
      fields.artifact_retention,
    ].join(" "),
  };
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
  const report = await buildReport({ policy, limit, discoveryOptions: readDiscoveryOptions(args) });
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
  const candidateId = readArg(args, "--candidate-id", null);
  const fetchArchives = readFlag(args, "--fetch-archives");
  const auditLog = new AuditLog();

  let report;
  if (!reportPath || (!manifestPath && !fetchArchives && !candidateId)) {
    throw new Error("inspect requires --report <scout_report.json> and either --manifest <manifest.json>, --fetch-archives, or --candidate-id.");
  } else {
    const baseReport = await loadReport(reportPath);
    const manifestModel = manifestPath ? await loadJson(manifestPath) : null;
    const targetCandidates = candidateId
      ? baseReport.candidates.filter((candidate) => candidate.candidate_id === candidateId)
      : baseReport.candidates;
    if (candidateId && targetCandidates.length === 0) {
      throw new Error(`Unknown candidate id: ${candidateId}`);
    }
    const inspectedCandidates = [];
    for (const candidate of targetCandidates) {
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
    const mergeCandidates = candidateId
      ? baseReport.candidates.map((candidate) => {
          const updated = inspectedCandidates.find((item) => item.candidate_id === candidate.candidate_id);
          return updated ?? candidate;
        })
      : inspectedCandidates;
    const decisions = triageCandidates(mergeCandidates, {
      profile: {
        profile_id: baseReport.triage_config?.profile_id,
        threshold_overrides: baseReport.triage_config?.threshold_overrides ?? {},
        discovery_intent: baseReport.discovery_intent ?? baseReport.triage_config?.discovery_intent,
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
      candidates: mergeCandidates,
      decisions,
      evidence: [...baseReport.evidence, ...staticEvidence],
      audit_events: [...baseReport.audit_events, ...auditLog.all()],
      monitor_events: baseReport.monitor_events,
      command_attempts: baseReport.command_attempts,
      discovery_intent: baseReport.discovery_intent ?? baseReport.triage_config?.discovery_intent,
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
    const intent = readArg(args, "--intent", null);
    const profileModel = createSearchProfile({
      name,
      languages,
      labels,
      exclude_orgs: excludeOrgs,
      exclude_repos: excludeRepos,
      trusted_seed_lists: trustedSeedLists,
      threshold_overrides: thresholdOverrides,
      max_candidates: maxCandidates,
      discovery_intent: intent ?? undefined,
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
    const report = await buildProfileReport({ policy, profile: profileModel, discoveryOptions: readDiscoveryOptions(args) });
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
  const skipKnown = readFlag(args, "--skip-known");
  const since = readArg(args, "--since", null);
  const notify = readFlag(args, "--notify");
  const profileModel = await loadProfileOrDefault(profileName);
  const policy = defaultPolicy("metadata_only");
  const previous = await loadMonitorSnapshot(profileName);
  const discoveryOptions = {
    ...readDiscoveryOptions(args),
    ...(since ? { since } : {}),
    ...(skipKnown && previous ? { knownCandidates: buildKnownCandidatesMap(previous) } : {}),
  };
  const current = await buildProfileReport({ policy, profile: profileModel, discoveryOptions });
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
    profile: profileModel,
    discovery_intent: current.discovery_intent ?? resolveDiscoveryIntent(profileModel),
    triage_config: current.triage_config,
  });
  await saveMonitorSnapshot(profileName, report);
  await writeReportOutputs(report, out, jsonOut);
  console.log(`Scout monitor report written to ${out}`);
  if (jsonOut) console.log(`Scout monitor machine report written to ${jsonOut}`);
  if (notify) {
    const summary = summarizeMonitorEvents(monitorEvents);
    console.log(`SCOUT_MONITOR profile=${profileName} new=${summary.new} improved=${summary.improved} downgraded=${summary.downgraded} missing=${summary.missing}`);
  }
  return monitorHasActionableEvents(monitorEvents) ? 1 : 0;
}

async function workflow(args) {
  const action = args[0];
  if (action === "resume") {
    const sessionDir = readArg(args, "--session", readArg(args, "--out-dir", "scout_session"));
    const manifest = await loadSessionManifest(sessionDir);
    const profileModel = manifest.profile ?? (await loadProfileOrDefault("default"));
    const reportPath = join(sessionDir, manifest.artifacts?.report_json ?? "scout_report.json");
    const report = await loadReport(reportPath);
    const shortlistLimit = readLimit(readArg(args, "--shortlist-limit", "10"));
    await executeWorkflow({
      outDir: sessionDir,
      profileModel,
      report,
      shortlistLimit,
      resume: true,
      existingManifest: manifest,
      renderAgentSummary,
      createNextActions,
    });
    console.log(`Scout workflow resumed in ${sessionDir}`);
    return 0;
  }
  if (action !== "run") {
    throw new Error("workflow command requires run or resume");
  }
  const profileName = readArg(args, "--profile", "default");
  const outDir = readArg(args, "--out-dir", "scout_session");
  const through = readArg(args, "--through", null);
  const shortlistLimit = readLimit(readArg(args, "--shortlist-limit", "10"));
  const profileModel = await loadProfileOrDefault(profileName);
  const policy = defaultPolicy("metadata_only");
  const discoveryOptions = readDiscoveryOptions(args);
  const report = await buildProfileReport({ policy, profile: profileModel, discoveryOptions });

  await executeWorkflow({
    outDir,
    profileModel,
    report,
    through,
    shortlistLimit,
    renderAgentSummary,
    createNextActions,
  });
  console.log(`Scout workflow artifacts written to ${outDir}`);
  return 0;
}

async function buildReport({ policy, limit, queries, profile = null, discoveryOptions = {} }) {
  const auditLog = new AuditLog();
  const evidence = [];
  const collectionErrors = [];
  const activeQueries = queries ?? DEFAULT_QUERIES;
  let candidates;
  try {
    candidates = await discoverCandidates({
      policy,
      limit,
      queries: activeQueries,
      auditLog,
      collectionErrors,
      profile,
      ...discoveryOptions,
    });
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

async function buildProfileReport({ policy, profile, discoveryOptions = {} }) {
  const trustedSeedLists = await loadTrustedSeedLists(profile.trusted_seed_lists ?? []);
  return buildReport({
    policy,
    limit: profile.max_candidates,
    queries: queriesFromProfile(profile, { trustedSeedLists }),
    profile,
    discoveryOptions,
  });
}

function readDiscoveryOptions(args) {
  const enrichMode = readArg(args, "--enrich-mode", null);
  return {
    cacheEnabled: !readFlag(args, "--no-cache"),
    ...(enrichMode ? { enrichMode } : {}),
  };
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
    throw new Error(`${name} must be valid JSON: ${error.message}`, { cause: error });
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
    throw new Error(`Unable to parse JSON at ${path}: ${error.message}`, { cause: error });
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

function renderAgentSummary(report, profile = null) {
  const recommended = report.decisions.filter((decision) => ["GREEN", "YELLOW"].includes(decision.verdict));
  const unknown = report.decisions.filter((decision) => decision.verdict === "GRAY");
  const dropped = report.decisions.filter((decision) => decision.verdict === "RED");
  const discoveryIntent = report.discovery_intent ?? resolveDiscoveryIntent(profile);
  return [
    "# Scout Agent Summary",
    "",
    `Discovery intent: ${discoveryIntent}`,
    `Run status: ${report.run_status}`,
    `Recommended: ${recommended.length}`,
    `Unknown: ${unknown.length}`,
    `Dropped: ${dropped.length}`,
    "",
    "No clone, install, repo script, dynamic probe, or GitHub write action was attempted.",
    "",
    "## Next Safe Step",
    recommended.length > 0
      ? discoveryIntent === "rewarded"
        ? "Review reward signals and income summaries manually before pursuing payout."
        : "Review the shortlist manually and choose candidates for static inspection or direct human review."
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

function printWorkflowHelp() {
  console.log(`Scout workflow

  scout workflow run --profile <id> --out-dir <dir> [--through discover,static,cockpit,handoff] [--shortlist-limit N] [--no-cache] [--enrich-mode auto|rest|graphql]
  scout workflow resume --session <dir> [--shortlist-limit N]

Stages: discover, static (manifest-only), cockpit, handoff`);
}

function printPlanHelp() {
  console.log(`Scout plan

  scout plan install-dry-run --report <json> --candidate-id <id> --contract <json>
  scout plan network-design --report <json> --candidate-id <id> [--contract <json>]`);
}

function printProbeHelp() {
  console.log(`Scout probe

  scout probe doctor [--image <image>] [--json-out <path>]
  scout probe --report <json> --candidate-id <id> --approval-id <id> [--network none|registry_allowlist] [--command-set readonly|install_probe|test_probe]`);
}

function printHelp() {
  console.log(`Scout 0.3.x

Agent-facing CLI commands:
  scout run --safe --limit 50 --out scout_report.md
  scout discover --limit 50 --no-cache --enrich-mode auto --out scout_report.md --json-out scout_report.json
  scout inspect --report scout_report.json --candidate-id SCOUT-0001 --out scout_static_report.md
  scout inspect --report scout_report.json --manifest manifest.json --out scout_static_report.md
  scout validate-report --report scout_report.json
  scout explain --candidate-id SCOUT-0001 --report scout_report.json
  scout export-shortlist --report scout_report.json --limit 25 --out scout_shortlist.md
  scout profile create beginner-python-ts --intent beginner
  scout profile run beginner-python-ts --out scout_report.md
  scout monitor --profile beginner-python-ts --skip-known --notify --out scout_watch_report.md
  scout workflow run --profile beginner-python-ts --out-dir scout_session --through discover,cockpit,handoff
  scout workflow resume --session scout_session
  scout cockpit --report scout_report.json
  scout handoff --report scout_report.json --json-out handoff_package.json
  scout probe doctor

Subcommand help: scout workflow --help | scout plan --help | scout probe --help

Discovery intents: beginner | rewarded
Performance: --no-cache, --enrich-mode auto|rest|graphql, SCOUT_GITHUB_CONCURRENCY`);
}

await loadEnv(process.cwd());
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error.message);
    process.exitCode = 1;
  },
);
