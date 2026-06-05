import { MODES } from "./types.js";

const metadataAllowed = [
  "github_search_read",
  "github_issue_metadata_read",
  "github_repo_metadata_read",
  "search_profile_read",
  "search_profile_write",
  "local_monitor_report_write",
  "report_write",
];

const staticAllowed = [
  ...metadataAllowed,
  "static_source_fetch",
  "archive_download",
  "static_file_read",
];

const dynamicAllowed = [
  ...staticAllowed,
  "sandbox_create",
  "sandbox_source_stage",
  "sandbox_command_run",
  "sandbox_artifact_read",
  "sandbox_destroy",
];

const alwaysDenied = [
  "git_clone",
  "recursive_submodule_fetch",
  "package_install",
  "shell_command",
  "repo_script_execution",
  "docker_build",
  "docker_run",
  "github_comment",
  "github_fork",
  "github_branch_create",
  "github_push",
  "github_pr_open",
  "github_write_action",
];

const approvalBoundSandboxOperations = Object.freeze([
  "sandbox_create",
  "sandbox_source_stage",
  "sandbox_command_run",
  "sandbox_artifact_read",
  "sandbox_destroy",
]);

export function defaultPolicy(mode = "metadata_only") {
  if (!MODES.includes(mode)) {
    throw new Error(`Unsupported Scout mode: ${mode}`);
  }

  return {
    mode,
    allowed_operations:
      mode === "dynamic_probe"
        ? dynamicAllowed
        : mode === "static_inspection"
          ? staticAllowed
          : metadataAllowed,
    denied_operations: alwaysDenied,
    requires_approval: [
      "static_source_fetch",
      "archive_download",
      ...approvalBoundSandboxOperations,
      "package_registry_network",
      "full_network_egress",
      "github_write_action",
    ],
    limits: {
      static_archive_max_mb: 100,
      static_file_count_max: 10000,
      repo_activity_days_green: 90,
      issue_freshness_days_green: 180,
      stale_issue_months_yellow_or_gray: 12,
      first_contribution_max_likely_files: 5,
    },
  };
}

export function decideOperation(policy, operation, approvalId = null) {
  if (policy.denied_operations?.includes(operation)) {
    return {
      decision: "denied",
      reason: `${operation} is denied by Scout policy in ${policy.mode} mode.`,
      approval_id: approvalId,
    };
  }

  if (policy.allowed_operations?.includes(operation)) {
    if (approvalBoundSandboxOperations.includes(operation) && !approvalId) {
      return {
        decision: "denied",
        reason: `${operation} requires a dynamic probe approval id and sandbox contract.`,
        approval_id: approvalId,
      };
    }
    return {
      decision: "allowed",
      reason: `${operation} is allowed in ${policy.mode} mode.`,
      approval_id: approvalId,
    };
  }

  if (policy.requires_approval?.includes(operation)) {
    return {
      decision: "denied",
      reason: `${operation} requires approval and is not allowed by current mode policy.`,
      approval_id: approvalId,
    };
  }

  return {
    decision: "denied",
    reason: `${operation} is unknown or not allowlisted by Scout policy.`,
    approval_id: approvalId,
  };
}

export function assertAllowed(policy, operation, approvalId = null) {
  const result = decideOperation(policy, operation, approvalId);
  if (result.decision !== "allowed") {
    const error = new Error(result.reason);
    error.code = "SCOUT_POLICY_DENIED";
    error.operation = operation;
    error.policyDecision = result;
    throw error;
  }
  return result;
}

export function createDenialMessage(operation, reason, nextSafeAction) {
  return [
    `DENIED: ${operation} is blocked.`,
    `Reason: ${reason}`,
    `Next safe action: ${nextSafeAction}`,
  ].join("\n");
}
