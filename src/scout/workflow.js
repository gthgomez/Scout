import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultPolicy } from "./policy.js";
import { createDecisionCockpitModel, exportHandoffPackages, renderDecisionCockpitSection } from "./decision-cockpit.js";
import { createReportModel, exportShortlist, renderMarkdownReport } from "./report.js";
import { triageCandidates } from "./triage.js";
import {
  evidenceFromStaticInspection,
  inspectCandidateStaticManifest,
} from "./static-inspection.js";
import {
  createSessionManifest,
  markStageComplete,
  parseThroughStages,
  resolvePendingStages,
  sessionManifestPath,
} from "./session.js";

export async function loadSessionManifest(outDir) {
  const raw = await readFile(sessionManifestPath(outDir), "utf8");
  return JSON.parse(raw);
}

export async function saveSessionManifest(outDir, manifest) {
  await mkdir(outDir, { recursive: true });
  await writeFile(sessionManifestPath(outDir), JSON.stringify(manifest, null, 2), "utf8");
}

export async function runWorkflowStage(stage, context) {
  const handlers = {
    discover: runDiscoverStage,
    static: runStaticStage,
    cockpit: runCockpitStage,
    handoff: runHandoffStage,
  };
  const handler = handlers[stage];
  if (!handler) {
    throw new Error(`Unknown workflow stage: ${stage}`);
  }
  return handler(context);
}

async function runDiscoverStage({
  outDir,
  report,
  profileModel,
  shortlistLimit,
  renderAgentSummary,
  createNextActions,
}) {
  const shortlist = exportShortlist(report, { limit: shortlistLimit });
  const summary = renderAgentSummary(report, profileModel);
  const nextActions = createNextActions(report);
  const handoff = exportHandoffPackages(report);

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "scout_report.md"), renderMarkdownReport(report), "utf8");
  await writeFile(join(outDir, "scout_report.json"), JSON.stringify(report, null, 2), "utf8");
  await writeFile(join(outDir, "scout_shortlist.md"), shortlist, "utf8");
  await writeFile(join(outDir, "agent_summary.md"), summary, "utf8");
  await writeFile(join(outDir, "codex_summary.md"), summary, "utf8");
  await writeFile(join(outDir, "next_actions.json"), JSON.stringify(nextActions, null, 2), "utf8");
  await writeFile(join(outDir, "handoff_package.json"), JSON.stringify(handoff, null, 2), "utf8");

  return markStageComplete(
    createSessionManifest({
      sessionId: outDir,
      profile: profileModel,
      stagesCompleted: ["discover"],
    }),
    "discover",
  );
}

async function runStaticStage({ outDir, report, profileModel, fetchArchives = false }) {
  if (fetchArchives) {
    throw new Error("workflow static stage does not support --fetch-archives; use scout inspect explicitly.");
  }

  const inspectedCandidates = report.candidates.map((candidate) =>
    inspectCandidateStaticManifest({
      policy: defaultPolicy("static_inspection"),
      candidate,
      manifest: null,
    }),
  );
  const staticEvidence = inspectedCandidates.flatMap(evidenceFromStaticInspection);
  const decisions = triageCandidates(inspectedCandidates, {
    profile: {
      profile_id: report.triage_config?.profile_id ?? profileModel?.profile_id,
      threshold_overrides: report.triage_config?.threshold_overrides ?? profileModel?.threshold_overrides ?? {},
      discovery_intent: report.discovery_intent ?? profileModel?.discovery_intent,
    },
  });

  const staticReport = createReportModel({
    run_status: report.run_status,
    collection_errors: report.collection_errors,
    candidates: inspectedCandidates,
    decisions,
    evidence: [...report.evidence, ...staticEvidence],
    audit_events: report.audit_events,
    monitor_events: report.monitor_events,
    command_attempts: report.command_attempts,
    discovery_intent: report.discovery_intent,
    triage_config: report.triage_config,
    profile: profileModel,
  });

  await writeFile(join(outDir, "scout_report.md"), renderMarkdownReport(staticReport), "utf8");
  await writeFile(join(outDir, "scout_report.json"), JSON.stringify(staticReport, null, 2), "utf8");
  await writeFile(join(outDir, "scout_static_report.md"), renderMarkdownReport(staticReport), "utf8");
  await writeFile(join(outDir, "scout_static_report.json"), JSON.stringify(staticReport, null, 2), "utf8");

  return { manifest: null, report: staticReport };
}

async function runCockpitStage({ outDir, report }) {
  const model = createDecisionCockpitModel(report);
  await writeFile(join(outDir, "scout_cockpit.md"), renderDecisionCockpitSection(model), "utf8");
  await writeFile(join(outDir, "scout_cockpit.json"), JSON.stringify(model, null, 2), "utf8");
  return { report };
}

async function runHandoffStage({ outDir, report, shortlistLimit }) {
  const handoff = exportHandoffPackages(report, { shortlistLimit });
  await writeFile(join(outDir, "handoff_package.json"), JSON.stringify(handoff, null, 2), "utf8");
  return { report };
}

export async function executeWorkflow({
  outDir,
  profileModel,
  report,
  through = null,
  shortlistLimit = 10,
  resume = false,
  existingManifest = null,
  renderAgentSummary,
  createNextActions,
}) {
  let manifest =
    existingManifest ??
    createSessionManifest({
      sessionId: outDir,
      profile: profileModel,
    });

  const stages = resume ? resolvePendingStages(manifest) : through ? parseThroughStages(through) : ["discover"];

  let currentReport = report;
  for (const stage of stages) {
    if (stage === "discover") {
      manifest = await runDiscoverStage({
        outDir,
        report: currentReport,
        profileModel,
        shortlistLimit,
        renderAgentSummary,
        createNextActions,
      });
      continue;
    }

    if (stage === "static") {
      const result = await runStaticStage({ outDir, report: currentReport, profileModel });
      currentReport = result.report;
      manifest = markStageComplete(manifest, "static", {
        static_report_json: "scout_static_report.json",
      });
      continue;
    }

    if (stage === "cockpit") {
      await runCockpitStage({ outDir, report: currentReport });
      manifest = markStageComplete(manifest, "cockpit", {
        cockpit_json: "scout_cockpit.json",
      });
      continue;
    }

    if (stage === "handoff") {
      await runHandoffStage({ outDir, report: currentReport, shortlistLimit });
      manifest = markStageComplete(manifest, "handoff");
    }
  }

  manifest = { ...manifest, profile: profileModel };
  await saveSessionManifest(outDir, manifest);
  return { manifest, report: currentReport };
}
