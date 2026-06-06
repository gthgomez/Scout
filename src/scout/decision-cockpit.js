const CONFIDENCE_CATEGORIES = Object.freeze([
  "metadata",
  "static_evidence",
  "sandbox_evidence",
  "maintainer_signal",
  "setup_signal",
  "scope_signal",
]);

export function createDecisionCockpitModel(report) {
  const candidates = report?.candidates ?? [];
  const decisions = report?.decisions ?? [];
  const evidence = report?.evidence ?? [];
  const attempts = report?.command_attempts ?? [];
  return {
    generated_at: new Date().toISOString(),
    candidates: decisions.map((decision) => {
      const candidate = candidates.find((item) => item.candidate_id === decision.candidate_id);
      const candidateEvidence = evidence.filter((item) => item.candidate_id === decision.candidate_id);
      const candidateAttempts = attempts.filter((item) => item.candidate_id === decision.candidate_id);
      const confidence = confidenceFor({ candidate, decision, evidence: candidateEvidence, attempts: candidateAttempts });
      return {
        candidate_id: decision.candidate_id,
        verdict: decision.verdict,
        rank: decision.rank ?? null,
        score: decision.score ?? null,
        repo: candidate ? `${candidate.repo_owner}/${candidate.repo_name}` : "unknown",
        issue_url: candidate?.issue_url ?? "",
        confidence,
        why_not_green: whyNotGreen({ candidate, decision, confidence }),
        what_would_change_my_mind: whatWouldChangeMyMind({ decision, confidence }),
        next_evidence_action: nextEvidenceAction(candidate, decision),
        handoff_package: {
          repo_url: candidate?.repo_url ?? "",
          issue_url: candidate?.issue_url ?? "",
          evidence_ids: candidateEvidence.map((item) => item.evidence_id),
          risks: [decision.risk_summary, decision.drop_reason].filter(Boolean),
          denied_commands: deniedCommands(candidate),
          suggested_first_files: suggestedFirstFiles(candidate),
          allowed_actions: ["manual_review", "static_inspection", "readonly_probe"],
          denied_actions: ["git_clone", "package_install", "repo_test_execution", "github_write", "issue_claim"],
        },
      };
    }),
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
      `- Repo: ${item.repo}`,
      `- Issue: ${item.issue_url}`,
      `- Confidence: ${confidence}`,
      `- Why not GREEN: ${item.why_not_green.join("; ") || "No current blocker."}`,
      `- What would change my mind: ${item.what_would_change_my_mind.join("; ") || "No extra evidence required."}`,
      `- Next evidence action: ${item.next_evidence_action.action} - ${item.next_evidence_action.reason}`,
      `- Handoff evidence IDs: ${item.handoff_package.evidence_ids.join(", ") || "none"}`,
      `- Handoff denied actions: ${item.handoff_package.denied_actions.join(", ")}`,
    ].join("\n");
  });
  return ["## R2G Decision Cockpit", "", ...rows].join("\n");
}

function confidenceFor({ candidate, decision, evidence, attempts }) {
  return {
    metadata: candidate?.collection_status === "OBSERVED" ? "high" : "low",
    static_evidence: evidence.some((item) => item.source_type === "STATIC_FILE") ? "high" : "low",
    sandbox_evidence: attempts.some((item) => item.status === "passed") ? "medium" : "none",
    maintainer_signal: candidate?.latest_maintainer_activity_at ? "medium" : "unknown",
    setup_signal: ["static_docs_ok", "passed"].includes(decision.setup_status) ? "medium" : "low",
    scope_signal: candidate?.estimated_files_touched ? "medium" : "unknown",
  };
}

function whyNotGreen({ candidate, decision, confidence }) {
  const reasons = [];
  if (decision.verdict === "GREEN") return reasons;
  if (decision.verdict === "RED" && decision.drop_reason) reasons.push(decision.drop_reason);
  if (decision.gap_codes?.length > 0) reasons.push(`Gap codes: ${decision.gap_codes.join(", ")}`);
  if (confidence.static_evidence === "low") reasons.push("Static evidence is incomplete.");
  if (confidence.setup_signal === "low") reasons.push("Setup confidence is low.");
  if (candidate?.claimed_in_comments) reasons.push("Issue appears claimed.");
  return [...new Set(reasons)];
}

function whatWouldChangeMyMind({ decision, confidence }) {
  const changes = [];
  if (decision.verdict === "RED") changes.push("Blocking condition must change before reconsidering.");
  if (confidence.static_evidence === "low") changes.push("Static inspection evidence with setup docs.");
  if (confidence.sandbox_evidence === "none") changes.push("Approved readonly probe evidence.");
  if (confidence.maintainer_signal === "unknown") changes.push("Observed maintainer activity or explicit maintainer guidance.");
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

function deniedCommands(candidate) {
  return candidate?.static_inspection?.setup_intelligence?.denied_commands ?? [];
}

function suggestedFirstFiles(candidate) {
  const files = candidate?.static_inspection?.setup_intelligence?.workspace?.manifest_paths ?? [];
  return files.length > 0 ? files : ["README.md", "CONTRIBUTING.md"];
}
