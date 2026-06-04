import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateMonitorEvent } from "./validators.js";

const verdictRank = { GREEN: 4, YELLOW: 3, GRAY: 2, RED: 1 };

export function diffReports(previousDecisions, currentDecisions, profileId) {
  const previousById = new Map(previousDecisions.map((decision) => [decision.candidate_id, decision]));
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
      events.push(createMonitorEvent(profileId, current, previous.verdict, "verdict_improved", "Candidate verdict improved."));
    } else if (verdictRank[current.verdict] < verdictRank[previous.verdict]) {
      events.push(createMonitorEvent(profileId, current, previous.verdict, "verdict_downgraded", "Candidate verdict downgraded."));
    }
  }
  return events.map(validateMonitorEvent);
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
