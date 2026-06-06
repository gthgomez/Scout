import { validateNetworkExpansionContract } from "./network-design.js";
import { setupIntelligenceFromCandidate } from "./setup-intelligence.js";

const SUPPORTED_INSTALL_MANAGERS = Object.freeze(["npm", "pnpm", "yarn", "pip", "poetry"]);
const INSTALL_STATUSES = Object.freeze(["planned", "unsupported_fail_closed"]);
const EXECUTION_STATUS = "not_executed";

export function createInstallProbeDryRunPlan(report, candidateId, contract) {
  const candidate = findCandidateWithStaticEvidence(report, candidateId);
  const networkContract = validateContractForCandidate(validateNetworkExpansionContract(contract), candidate);
  const intelligence = setupIntelligenceFromCandidate(candidate);
  const packageManager = choosePackageManager(intelligence);
  const lifecycleRisk = hasLifecycleRisk(intelligence);
  const unsupportedReason = unsupportedInstallReason({ packageManager, lifecycleRisk, lifecyclePolicy: networkContract.lifecycle_policy });
  const proposedArgv = unsupportedReason ? [] : proposedInstallArgv(packageManager, networkContract.lifecycle_policy);

  return validateInstallProbeDryRunPlan({
    plan_id: `install-dry-run-${candidateId}`,
    candidate_id: candidateId,
    repo: `${candidate.repo_owner}/${candidate.repo_name}`,
    issue: candidate.issue_url,
    network_policy: networkContract.network_policy,
    registry_hosts: networkContract.registry_hosts,
    package_manager: packageManager ?? "unknown",
    lifecycle_policy: unsupportedReason ? "unsupported_fail_closed" : networkContract.lifecycle_policy,
    status: unsupportedReason ? "unsupported_fail_closed" : "planned",
    execution_status: EXECUTION_STATUS,
    proposed_argv: proposedArgv,
    denied_commands: intelligence.denied_commands ?? [],
    timeout_seconds: networkContract.timeout_seconds,
    artifact_retention: networkContract.artifact_retention,
    approval_phrase: networkContract.approval_phrase,
    reason: unsupportedReason ?? "Install probe dry run was planned but not executed.",
  });
}

export function validateInstallProbeDryRunPlan(plan) {
  assertObject(plan, "InstallProbeDryRunPlan");
  [
    "plan_id",
    "candidate_id",
    "repo",
    "issue",
    "network_policy",
    "package_manager",
    "lifecycle_policy",
    "status",
    "execution_status",
    "artifact_retention",
    "approval_phrase",
    "reason",
  ].forEach((field) => assertString(plan[field], `InstallProbeDryRunPlan.${field}`));
  assertEnum(plan.network_policy, ["registry_allowlist"], "InstallProbeDryRunPlan.network_policy");
  assertEnum(plan.lifecycle_policy, ["scripts_disabled", "scripts_audited_allowlist", "unsupported_fail_closed"], "InstallProbeDryRunPlan.lifecycle_policy");
  assertEnum(plan.status, INSTALL_STATUSES, "InstallProbeDryRunPlan.status");
  assertEnum(plan.execution_status, [EXECUTION_STATUS], "InstallProbeDryRunPlan.execution_status");
  assertArray(plan.registry_hosts, "InstallProbeDryRunPlan.registry_hosts");
  if (plan.registry_hosts.length === 0) {
    throw new Error("InstallProbeDryRunPlan.registry_hosts must not be empty");
  }
  assertArray(plan.proposed_argv, "InstallProbeDryRunPlan.proposed_argv");
  plan.proposed_argv.forEach((command, index) => validateArgv(command, `InstallProbeDryRunPlan.proposed_argv[${index}]`));
  assertArray(plan.denied_commands, "InstallProbeDryRunPlan.denied_commands");
  assertFiniteInteger(plan.timeout_seconds, "InstallProbeDryRunPlan.timeout_seconds", { min: 1 });
  if (plan.status === "planned" && plan.proposed_argv.length === 0) {
    throw new Error("InstallProbeDryRunPlan.proposed_argv is required for planned status");
  }
  if (plan.status === "unsupported_fail_closed" && plan.proposed_argv.length > 0) {
    throw new Error("InstallProbeDryRunPlan.proposed_argv must be empty when fail-closed");
  }
  return plan;
}

export function renderInstallProbeDryRunSection(plan) {
  const validated = validateInstallProbeDryRunPlan(plan);
  const commands = validated.proposed_argv.length === 0
    ? ["- None; plan failed closed."]
    : validated.proposed_argv.map((command) => `- ${command.join(" ")}`);
  return [
    "## R2E Install Probe Dry Run",
    "",
    "Status: not executed. This section is a future install-probe plan only.",
    "",
    `- Candidate: ${validated.candidate_id}`,
    `- Repo: ${validated.repo}`,
    `- Issue: ${validated.issue}`,
    `- Package manager: ${validated.package_manager}`,
    `- Lifecycle policy: ${validated.lifecycle_policy}`,
    `- Network policy: ${validated.network_policy}`,
    `- Registry hosts: ${validated.registry_hosts.join(", ")}`,
    `- Timeout: ${validated.timeout_seconds}s`,
    `- Artifact retention: ${validated.artifact_retention}`,
    `- Result: ${validated.status} (${validated.reason})`,
    "",
    "Proposed commands:",
    ...commands,
    "",
    "Command attempts: none. Setup status: not executed.",
  ].join("\n");
}

export function createTestProbeDesignPlan(report, candidateId, installPlan) {
  const candidate = findCandidateWithStaticEvidence(report, candidateId);
  const validatedInstallPlan = validateInstallProbeDryRunPlan(installPlan);
  if (validatedInstallPlan.candidate_id !== candidateId) {
    throw new Error("TestProbeDesignPlan requires install plan for the same candidate");
  }
  const intelligence = setupIntelligenceFromCandidate(candidate);
  const proposedArgv = proposedTestArgv(intelligence, validatedInstallPlan.package_manager);
  return validateTestProbeDesignPlan({
    plan_id: `test-design-${candidateId}`,
    candidate_id: candidateId,
    prerequisite: "install_probe_evidence_required",
    execution_status: EXECUTION_STATUS,
    status: proposedArgv.length > 0 ? "blocked_pending_install_probe" : "unsupported_fail_closed",
    proposed_argv: proposedArgv,
    reason: proposedArgv.length > 0
      ? "Test probe remains blocked until an approved executable install probe exists."
      : "No static manifest-derived test command was found.",
  });
}

export function validateTestProbeDesignPlan(plan) {
  assertObject(plan, "TestProbeDesignPlan");
  ["plan_id", "candidate_id", "prerequisite", "execution_status", "status", "reason"].forEach((field) =>
    assertString(plan[field], `TestProbeDesignPlan.${field}`),
  );
  assertEnum(plan.prerequisite, ["install_probe_evidence_required"], "TestProbeDesignPlan.prerequisite");
  assertEnum(plan.execution_status, [EXECUTION_STATUS], "TestProbeDesignPlan.execution_status");
  assertEnum(plan.status, ["blocked_pending_install_probe", "unsupported_fail_closed"], "TestProbeDesignPlan.status");
  assertArray(plan.proposed_argv, "TestProbeDesignPlan.proposed_argv");
  plan.proposed_argv.forEach((command, index) => validateArgv(command, `TestProbeDesignPlan.proposed_argv[${index}]`));
  return plan;
}

function findCandidateWithStaticEvidence(report, candidateId) {
  const candidate = report?.candidates?.find((item) => item.candidate_id === candidateId);
  if (!candidate) {
    throw new Error(`Unknown candidate id: ${candidateId}`);
  }
  const hasStaticStatus = ["static_docs_ok", "static_docs_risky"].includes(candidate.static_inspection_status);
  const hasStaticEvidence = (report?.evidence ?? []).some((item) => item.candidate_id === candidateId && item.source_type === "STATIC_FILE");
  if (!hasStaticStatus && !hasStaticEvidence) {
    throw new Error(`Candidate ${candidateId} must have static inspection evidence before install dry-run planning.`);
  }
  return candidate;
}

function validateContractForCandidate(contract, candidate) {
  const repo = `${candidate.repo_owner}/${candidate.repo_name}`;
  if (contract.candidate_id !== candidate.candidate_id) {
    throw new Error("NetworkExpansionContract candidate_id must match the install dry-run candidate");
  }
  if (contract.repo !== repo) {
    throw new Error("NetworkExpansionContract repo must match the install dry-run candidate");
  }
  if (contract.issue !== candidate.issue_url) {
    throw new Error("NetworkExpansionContract issue must match the install dry-run candidate");
  }
  return contract;
}

function choosePackageManager(intelligence) {
  return SUPPORTED_INSTALL_MANAGERS.find((manager) => (intelligence.package_managers ?? []).includes(manager)) ?? null;
}

function hasLifecycleRisk(intelligence) {
  return (intelligence.risk_signals ?? []).some((signal) => signal.kind === "npm_lifecycle_script");
}

function unsupportedInstallReason({ packageManager, lifecycleRisk, lifecyclePolicy }) {
  if (!packageManager) {
    return "Unsupported ecosystem or package manager; fail closed.";
  }
  if (lifecycleRisk && !["scripts_disabled", "scripts_audited_allowlist"].includes(lifecyclePolicy)) {
    return "Lifecycle scripts were detected and the lifecycle policy does not permit a controlled dry-run plan.";
  }
  return null;
}

function proposedInstallArgv(packageManager, lifecyclePolicy) {
  const disableScripts = lifecyclePolicy === "scripts_disabled";
  if (packageManager === "npm") return [["npm", "ci", ...(disableScripts ? ["--ignore-scripts"] : [])]];
  if (packageManager === "pnpm") return [["pnpm", "install", ...(disableScripts ? ["--ignore-scripts"] : [])]];
  if (packageManager === "yarn") return [["yarn", "install", ...(disableScripts ? ["--ignore-scripts"] : [])]];
  if (packageManager === "pip") return [["python", "-m", "pip", "install", "-r", "requirements.txt"]];
  if (packageManager === "poetry") return [["poetry", "install", ...(disableScripts ? ["--no-root"] : [])]];
  return [];
}

function proposedTestArgv(intelligence, packageManager) {
  const testPaths = intelligence.workspace?.test_paths ?? [];
  if (testPaths.includes("package.json:scripts.test") && ["npm", "pnpm", "yarn"].includes(packageManager)) {
    return [[packageManager, "test"]];
  }
  if (testPaths.some((path) => path.startsWith(".github/workflows/"))) {
    return [["echo", "Static workflow evidence only; test execution remains blocked."]];
  }
  return [];
}

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function assertString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function assertArray(value, name) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
}

function assertFiniteInteger(value, name, options = {}) {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${name} must be a finite integer`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`${name} must be at least ${options.min}`);
  }
}

function assertEnum(value, allowed, name) {
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
}

function validateArgv(command, name) {
  assertArray(command, name);
  if (command.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  command.forEach((part, index) => assertString(part, `${name}[${index}]`));
}
