import { resolveDiscoveryIntent } from "./profiles.js";

const CONFIDENCE_CATEGORIES = Object.freeze([
  "metadata",
  "static_evidence",
  "sandbox_evidence",
  "maintainer_signal",
  "setup_signal",
  "scope_signal",
  "reward_signal",
]);

export function createDecisionCockpitModel(report) {
  const candidates = report?.candidates ?? [];
  const decisions = report?.decisions ?? [];
  const evidence = report?.evidence ?? [];
  const attempts = report?.command_attempts ?? [];
  const discoveryIntent = report?.discovery_intent ?? resolveDiscoveryIntent(report?.profile);
  return {
    generated_at: new Date().toISOString(),
    discovery_intent: discoveryIntent,
    candidates: decisions.map((decision) => {
      const candidate = candidates.find((item) => item.candidate_id === decision.candidate_id);
      const candidateEvidence = evidence.filter((item) => item.candidate_id === decision.candidate_id);
      const candidateAttempts = attempts.filter((item) => item.candidate_id === decision.candidate_id);
      const confidence = confidenceFor({ candidate, decision, evidence: candidateEvidence, attempts: candidateAttempts, discoveryIntent });
      const handoffPackage = buildHandoffPackage({ candidate, decision, evidence: candidateEvidence, discoveryIntent });
      return {
        candidate_id: decision.candidate_id,
        verdict: decision.verdict,
        rank: decision.rank ?? null,
        score: decision.score ?? null,
        repo: candidate ? `${candidate.repo_owner}/${candidate.repo_name}` : "unknown",
        issue_url: candidate?.issue_url ?? "",
        discovery_intent: decision.discovery_intent ?? discoveryIntent,
        income_summary: decision.income_summary ?? null,
        confidence,
        why_not_green: whyNotGreen({ candidate, decision, confidence, discoveryIntent }),
        what_would_change_my_mind: whatWouldChangeMyMind({ decision, confidence, discoveryIntent }),
        next_evidence_action: nextEvidenceAction(candidate, decision),
        handoff_package: handoffPackage,
      };
    }),
  };
}

export function exportHandoffPackages(report) {
  const model = createDecisionCockpitModel(report);
  return {
    generated_at: model.generated_at,
    discovery_intent: model.discovery_intent,
    reward_disclaimer:
      model.discovery_intent === "rewarded"
        ? "Scout does not verify payout amounts, bounty platform terms, or sponsor obligations."
        : null,
    packages: model.candidates.map((item) => ({
      candidate_id: item.candidate_id,
      verdict: item.verdict,
      discovery_intent: item.discovery_intent,
      income_summary: item.income_summary,
      ...item.handoff_package,
    })),
  };
}

export function renderDecisionCockpitSection(model) {
  const rows = model.candidates.map((item) => {
    const confidence = CONFIDENCE_CATEGORIES
      .map((category) => `${category}:${item.confidence[category]}`)
      .join(", ");
    return [
      `### ${item.candidate_id}`,
      "",
      `- Verdict: ${item.verdict}`,
      `- Discovery intent: ${item.discovery_intent ?? model.discovery_intent ?? "beginner"}`,
      `- Repo: ${item.repo}`,
      `- Issue: ${item.issue_url}`,
      `- Confidence: ${confidence}`,
      ...(item.income_summary ? [`- Income summary: ${item.income_summary}`] : []),
      `- Why not GREEN: ${item.why_not_green.join("; ") || "No current blocker."}`,
      `- What would change my mind: ${item.what_would_change_my_mind.join("; ") || "No extra evidence required."}`,
      `- Next evidence action: ${item.next_evidence_action.action} - ${item.next_evidence_action.reason}`,
      `- Handoff evidence IDs: ${item.handoff_package.evidence_ids.join(", ") || "none"}`,
      `- Handoff denied actions: ${item.handoff_package.denied_actions.join(", ")}`,
    ].join("\n");
  });
  return ["## Scout Decision Cockpit", "", ...rows].join("\n");
}

function confidenceFor({ candidate, decision, evidence, attempts, discoveryIntent }) {
  const rewardSignal = (() => {
    if (discoveryIntent !== "rewarded") return "n/a";
    if (candidate?.has_verified_reward_signal) return "high";
    if (candidate?.has_inferred_reward_signal) return "medium";
    return "none";
  })();
  return {
    metadata: candidate?.collection_status === "OBSERVED" ? "high" : "low",
    static_evidence: evidence.some((item) => item.source_type === "STATIC_FILE") ? "high" : "low",
    sandbox_evidence: attempts.some((item) => item.status === "passed") ? "medium" : "none",
    maintainer_signal: candidate?.latest_maintainer_activity_at ? "medium" : "unknown",
    setup_signal: ["static_docs_ok", "passed"].includes(decision.setup_status) ? "medium" : "low",
    scope_signal: candidate?.estimated_files_touched ? "medium" : "unknown",
    reward_signal: rewardSignal,
  };
}

function whyNotGreen({ candidate, decision, confidence, discoveryIntent }) {
  const reasons = [];
  if (decision.verdict === "GREEN") return reasons;
  if (decision.verdict === "RED" && decision.drop_reason) reasons.push(decision.drop_reason);
  if (decision.gap_codes?.length > 0) reasons.push(`Gap codes: ${decision.gap_codes.join(", ")}`);
  if (confidence.static_evidence === "low") reasons.push("Static evidence is incomplete.");
  if (confidence.setup_signal === "low" && discoveryIntent !== "rewarded") reasons.push("Setup confidence is low.");
  if (discoveryIntent === "rewarded" && confidence.reward_signal === "none") reasons.push("No reward signal detected.");
  if (candidate?.claimed_in_comments) reasons.push("Issue appears claimed.");
  return [...new Set(reasons)];
}

function whatWouldChangeMyMind({ decision, confidence, discoveryIntent }) {
  const changes = [];
  if (decision.verdict === "RED") changes.push("Blocking condition must change before reconsidering.");
  if (confidence.static_evidence === "low") changes.push("Static inspection evidence with setup docs.");
  if (confidence.sandbox_evidence === "none") changes.push("Approved readonly probe evidence.");
  if (confidence.maintainer_signal === "unknown") changes.push("Observed maintainer activity or explicit maintainer guidance.");
  if (discoveryIntent === "rewarded" && confidence.reward_signal !== "high") {
    changes.push("Verified bounty label or explicit payout mention in issue metadata.");
  }
  return [...new Set(changes)];
}

function nextEvidenceAction(candidate, decision) {
  const intelligenceAction = candidate?.static_inspection?.setup_intelligence?.recommended_next_evidence_action;
  if (intelligenceAction) return intelligenceAction;
  if (decision.verdict === "GREEN") {
    return { action: "human_review", reason: "Review evidence before any public engagement." };
  }
  if (decision.verdict === "RED") {
    return { action: "drop", reason: decision.drop_reason ?? "Hard drop condition was detected." };
  }
  return { action: "static_inspection", reason: "More static evidence is needed." };
}

function buildHandoffPackage({ candidate, decision, evidence, discoveryIntent }) {
  return {
    repo_url: candidate?.repo_url ?? "",
    issue_url: candidate?.issue_url ?? "",
    discovery_intent: discoveryIntent,
    income_summary: decision.income_summary ?? null,
    reward_signals: candidate?.reward_signals ?? [],
    evidence_ids: evidence.map((item) => item.evidence_id),
    risks: [decision.risk_summary, decision.drop_reason].filter(Boolean),
    denied_commands: deniedCommands(candidate),
    suggested_first_files: suggestedFirstFiles(candidate),
    allowed_actions: ["manual_review", "static_inspection", "readonly_probe"],
    denied_actions: ["git_clone", "package_install", "repo_test_execution", "github_write", "issue_claim"],
    agent_notes:
      discoveryIntent === "rewarded"
        ? "Reward metadata is inferred from GitHub labels/title/body only; verify payout terms manually."
        : "Beginner-fit candidate; confirm setup docs before claiming.",
  };
}

function deniedCommands(candidate) {
  return candidate?.static_inspection?.setup_intelligence?.denied_commands ?? [];
}

function suggestedFirstFiles(candidate) {
  const files = candidate?.static_inspection?.setup_intelligence?.workspace?.manifest_paths ?? [];
  return files.length > 0 ? files : ["README.md", "CONTRIBUTING.md"];
}
