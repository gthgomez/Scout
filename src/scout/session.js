import { join } from "node:path";

export const WORKFLOW_STAGES = Object.freeze(["discover", "static", "cockpit", "handoff"]);

export const WORKFLOW_PRESETS = Object.freeze({
  fast: "discover,cockpit,handoff",
  full: "discover,static,cockpit,handoff",
});

export function resolveWorkflowPreset(presetName) {
  const through = WORKFLOW_PRESETS[presetName];
  if (!through) {
    throw new Error(`Unknown workflow preset: ${presetName}. Allowed: ${Object.keys(WORKFLOW_PRESETS).join(", ")}`);
  }
  return through;
}

export function createSessionManifest({
  sessionId,
  profile,
  stagesCompleted = [],
  artifacts = {},
  workflowPresetRequested = null,
  workflowPresetEffective = null,
  staticFetchArchives = false,
  generatedAt = new Date().toISOString(),
}) {
  return {
    session_id: sessionId,
    profile,
    workflow_preset_requested: workflowPresetRequested,
    workflow_preset_effective: workflowPresetEffective,
    static_fetch_archives: staticFetchArchives,
    stages_completed: [...stagesCompleted],
    artifacts: {
      report_json: "scout_report.json",
      report_md: "scout_report.md",
      shortlist_md: "scout_shortlist.md",
      agent_summary_md: "agent_summary.md",
      handoff_json: "handoff_package.json",
      ...artifacts,
    },
    generated_at: generatedAt,
  };
}

export function sessionManifestPath(outDir) {
  return join(outDir, "scout_session.json");
}

export function resolvePendingStages(manifest, requestedThrough = null) {
  const completed = new Set(manifest.stages_completed ?? []);
  const pipeline = requestedThrough
    ? parseThroughStages(requestedThrough)
    : WORKFLOW_STAGES.filter((stage) => !completed.has(stage));
  return pipeline.filter((stage) => !completed.has(stage));
}

export function parseThroughStages(raw) {
  const stages = String(raw)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const stage of stages) {
    if (!WORKFLOW_STAGES.includes(stage)) {
      throw new Error(`Unknown workflow stage: ${stage}. Allowed: ${WORKFLOW_STAGES.join(", ")}`);
    }
  }
  return stages;
}

export function markStageComplete(manifest, stage, artifacts = {}) {
  const stages = new Set(manifest.stages_completed ?? []);
  stages.add(stage);
  return {
    ...manifest,
    stages_completed: [...stages],
    artifacts: { ...manifest.artifacts, ...artifacts },
    generated_at: new Date().toISOString(),
  };
}
