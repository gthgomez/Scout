export const VERDICTS = Object.freeze(["GREEN", "YELLOW", "RED", "GRAY"]);

export const TRUST_LEVELS = Object.freeze(["OBSERVED", "INFERRED", "PROPOSED", "UNKNOWN"]);

export const SOURCE_TYPES = Object.freeze([
  "GITHUB_API",
  "STATIC_FILE",
  "SANDBOX_COMMAND",
  "HUMAN_INPUT",
  "INFERRED",
  "UNKNOWN",
]);

export const SETUP_STATUSES = Object.freeze([
  "not_executed",
  "unknown",
  "static_docs_ok",
  "static_docs_risky",
  "passed",
]);

export const MODES = Object.freeze(["metadata_only", "static_inspection", "dynamic_probe"]);

export const RUN_STATUSES = Object.freeze(["complete", "partial", "failed"]);

export const STATIC_INSPECTION_STATUSES = Object.freeze([
  "not_requested",
  "not_inspected",
  "missing_manifest",
  "insufficient_static_evidence",
  "static_docs_ok",
  "static_docs_risky",
]);

export const GAP_CODES = Object.freeze([
  "ARCHITECTURE_GAP",
  "SECURITY_GAP",
  "SCHEMA_GAP",
  "PERMISSION_GAP",
  "EVAL_GAP",
  "EXECUTION_GAP",
  "SOURCE_GAP",
  "TEST_GAP",
  "ROLLBACK_GAP",
  "MONITORING_GAP",
  "REWARD_GAP",
]);

export const DISCOVERY_INTENTS = Object.freeze(["beginner", "rewarded"]);

export const OPERATIONS = Object.freeze([
  "github_search_read",
  "github_issue_metadata_read",
  "github_repo_metadata_read",
  "static_source_fetch",
  "archive_download",
  "static_file_read",
  "sandbox_create",
  "sandbox_source_stage",
  "sandbox_command_run",
  "sandbox_artifact_read",
  "sandbox_destroy",
  "search_profile_read",
  "search_profile_write",
  "local_monitor_report_write",
  "package_install",
  "shell_command",
  "git_clone",
  "recursive_submodule_fetch",
  "repo_script_execution",
  "docker_build",
  "docker_run",
  "report_write",
  "github_comment",
  "github_fork",
  "github_branch_create",
  "github_push",
  "github_pr_open",
  "github_write_action",
]);
