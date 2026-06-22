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
        reward_signal_label: formatRewardSignalLabel(confidence.reward_signal),
        why_not_green: whyNotGreen({ candidate, decision, confidence, discoveryIntent }),
        what_would_change_my_mind: whatWouldChangeMyMind({ decision, confidence, discoveryIntent }),
        next_evidence_action: nextEvidenceAction(candidate, decision),
        handoff_package: handoffPackage,
      };
    }),
  };
}

export function exportHandoffPackages(report, options = {}) {
  const model = createDecisionCockpitModel(report);
  const shortlistLimit = options.shortlistLimit ?? 10;
  const workflowPreset = options.workflowPresetEffective ?? "fast";
  const handoffMode = options.handoffMode ?? (workflowPreset === "full" ? "static_verified" : "metadata_only");
  const reportPath = options.reportPath ?? "scout_report.json";
  const candidateById = new Map((report?.candidates ?? []).map((candidate) => [candidate.candidate_id, candidate]));
  const recommended = model.candidates
    .filter((item) => isRecommendablePackage(item, { handoffMode, workflowPreset }))
    .filter((item) => {
      if (!report?.profile?.require_verified_reward) return true;
      const candidate = candidateById.get(item.candidate_id);
      return Boolean(candidate?.has_verified_reward_signal ?? candidate?.has_observed_reward_metadata);
    })
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .slice(0, shortlistLimit)
    .map((item) => item.candidate_id);

  const packages = model.candidates.map((item) => {
    const candidate = candidateById.get(item.candidate_id);
    return {
      candidate_id: item.candidate_id,
      verdict: item.verdict,
      discovery_intent: item.discovery_intent,
      income_summary: item.income_summary,
      has_observed_reward_metadata: Boolean(
        candidate?.has_observed_reward_metadata ?? candidate?.has_verified_reward_signal,
      ),
      ...item.handoff_package,
    };
  });

  return {
    schema_version: "1.1",
    entrypoint: "handoff_package.json",
    generated_at: model.generated_at,
    discovery_intent: model.discovery_intent,
    handoff_mode: handoffMode,
    workflow_preset: workflowPreset,
    reward_disclaimer:
      model.discovery_intent === "rewarded"
        ? "Scout does not verify payout amounts, bounty platform terms, or sponsor obligations."
        : null,
    recommended_packages: recommended,
    suggested_commands: recommended.map((candidateId) => ({
      kind: "readonly_cli",
      command: `scout explain --candidate-id ${candidateId} --report ${reportPath}`,
      cwd: options.sessionDir ?? null,
      reason: "Review evidence-backed verdict reasoning before any engagement.",
    })),
    packages,
  };
}

function isRecommendablePackage(item, { handoffMode, workflowPreset }) {
  if (["RED", "GRAY"].includes(item.verdict)) return false;

  const hasStaticEvidence = item.confidence.static_evidence !== "low";

  if (workflowPreset === "fast" || handoffMode === "metadata_only") {
    if (item.verdict === "GREEN") return true;
    if (item.verdict === "YELLOW" && hasStaticEvidence) return true;
    return false;
  }

  if (item.verdict === "GREEN") return true;
  if (item.verdict === "YELLOW" && hasStaticEvidence) return true;
  return false;
}

export function renderDecisionCockpitSection(model, options = {}) {
  const workflowPreset = options.workflowPresetEffective ?? "fast";
  const staticFetchArchives = options.staticFetchArchives ?? false;
  const lines = ["## Scout Decision Cockpit", ""];

  if (shouldShowMetadataOnlyBanner(model, { workflowPreset, staticFetchArchives })) {
    lines.push(
      "> **Metadata-only handoff warning:** This session skipped archive-backed static inspection (fast preset or no GitHub token). Recommended packages may lack setup-file evidence. Run `scout workflow run --workflow-preset full` before coding-agent handoff.",
      "",
    );
  }

  const rows = model.candidates.map((item) => {
    const confidence = CONFIDENCE_CATEGORIES.map((category) => {
      const value = item.confidence[category];
      if (category === "reward_signal" && value === "high") {
        return `${category}:${value} (observed in metadata)`;
      }
      return `${category}:${value}`;
    }).join(", ");
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
  return [...lines, ...rows].join("\n");
}

function shouldShowMetadataOnlyBanner(model, { workflowPreset, staticFetchArchives }) {
  if (workflowPreset === "full" && staticFetchArchives) return false;
  const recommended = model.candidates.filter((item) => ["GREEN", "YELLOW"].includes(item.verdict));
  if (recommended.length === 0) return false;
  return recommended.every((item) => item.confidence.static_evidence === "low");
}

function formatRewardSignalLabel(rewardSignal) {
  if (rewardSignal === "high") return "observed in metadata";
  if (rewardSignal === "medium") return "inferred in metadata";
  if (rewardSignal === "none") return "none";
  return "n/a";
}

function confidenceFor({ candidate, decision, evidence, attempts, discoveryIntent }) {
  const rewardSignal = (() => {
    if (discoveryIntent !== "rewarded") return "n/a";
    if (candidate?.has_verified_reward_signal || candidate?.has_observed_reward_metadata) return "high";
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
    has_observed_reward_metadata: Boolean(
      candidate?.has_observed_reward_metadata ?? candidate?.has_verified_reward_signal,
    ),
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
