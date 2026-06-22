import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_THRESHOLDS } from "./triage.js";
import { validateMonitorEvent } from "./validators.js";

const verdictRank = { GREEN: 4, YELLOW: 3, GRAY: 2, RED: 1 };

export function diffReports(previousDecisions, currentDecisions, profileId) {
  const previousById = new Map(previousDecisions.map((decision) => [decision.candidate_id, decision]));
  const currentById = new Map(currentDecisions.map((decision) => [decision.candidate_id, decision]));
  const events = [];
  for (const current of currentDecisions) {
    const previous = previousById.get(current.candidate_id);
    if (!previous) {
      events.push(createMonitorEvent(profileId, current, null, "new_candidate", "New candidate found."));
      continue;
    }
    if (current.verdict === "RED" && previous.verdict !== "RED") {
      events.push(createMonitorEvent(profileId, current, previous.verdict, "verdict_downgraded", current.drop_reason ?? "Candidate downgraded."));
      continue;
    }
    if (verdictRank[current.verdict] > verdictRank[previous.verdict]) {
      events.push(
        createMonitorEvent(
          profileId,
          current,
          previous.verdict,
          "verdict_improved",
          verdictChangeReason(previous, current, "Candidate verdict improved."),
        ),
      );
    } else if (verdictRank[current.verdict] < verdictRank[previous.verdict]) {
      events.push(
        createMonitorEvent(
          profileId,
          current,
          previous.verdict,
          "verdict_downgraded",
          verdictChangeReason(previous, current, "Candidate verdict downgraded."),
        ),
      );
    }
  }
  for (const previous of previousDecisions) {
    if (!currentById.has(previous.candidate_id)) {
      events.push(createMissingCandidateEvent(profileId, previous));
    }
  }
  return events.map(validateMonitorEvent);
}

function verdictChangeReason(previous, current, fallback) {
  if (!thresholdPolicyChanged(previous, current)) {
    return fallback;
  }
  return `${fallback} Threshold policy changed.`;
}

function thresholdPolicyChanged(previous, current) {
  return JSON.stringify(effectiveThresholds(previous)) !== JSON.stringify(effectiveThresholds(current));
}

function effectiveThresholds(decision) {
  return decision.threshold_policy?.effective_thresholds ?? DEFAULT_THRESHOLDS;
}

export function monitorStoreDir(root = process.cwd()) {
  return join(root, ".scout", "monitor");
}

export function monitorSnapshotFile(profileName, root = process.cwd()) {
  const slug = String(profileName)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) {
    throw new Error("Monitor profile name must contain at least one alphanumeric character.");
  }
  return join(monitorStoreDir(root), `${slug}.json`);
}

export async function loadMonitorSnapshot(profileName, options = {}) {
  const path = monitorSnapshotFile(profileName, options.root);
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function saveMonitorSnapshot(profileName, report, options = {}) {
  const path = monitorSnapshotFile(profileName, options.root);
  await mkdir(monitorStoreDir(options.root), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2), "utf8");
  return path;
}

function createMonitorEvent(profileId, decision, previousVerdict, changeType, reason) {
  return {
    event_id: `monitor-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    profile_id: profileId,
    candidate_id: decision.candidate_id,
    observed_at: new Date().toISOString(),
    change_type: changeType,
    previous_verdict: previousVerdict,
    current_verdict: decision.verdict,
    reason,
    human_next_action: decision.human_next_action,
  };
}

function createMissingCandidateEvent(profileId, previous) {
  return {
    event_id: `monitor-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    profile_id: profileId,
    candidate_id: previous.candidate_id,
    observed_at: new Date().toISOString(),
    change_type: "candidate_missing",
    previous_verdict: previous.verdict,
    current_verdict: "GRAY",
    reason: "Candidate no longer appears in the current search results.",
    human_next_action: "Review before acting; the issue may be closed, relabeled, claimed, or outside the current profile.",
  };
}

export function buildKnownCandidatesMap(previousReport) {
  const map = new Map();
  if (!previousReport?.candidates) return map;
  for (const candidate of previousReport.candidates) {
    map.set(`${candidate.repo_owner}/${candidate.repo_name}#${candidate.issue_number}`, candidate);
  }
  return map;
}

export function summarizeMonitorEvents(events) {
  const summary = { new: 0, improved: 0, downgraded: 0, missing: 0 };
  for (const event of events) {
    if (event.change_type === "new_candidate") summary.new += 1;
    if (event.change_type === "verdict_improved") summary.improved += 1;
    if (event.change_type === "verdict_downgraded") summary.downgraded += 1;
    if (event.change_type === "candidate_missing") summary.missing += 1;
  }
  return summary;
}

export function monitorHasActionableEvents(events) {
  return events.some((event) => ["new_candidate", "verdict_improved"].includes(event.change_type));
}
