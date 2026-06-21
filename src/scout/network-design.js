const NETWORK_POLICIES = Object.freeze(["registry_allowlist"]);
const LIFECYCLE_POLICIES = Object.freeze([
  "scripts_disabled",
  "scripts_audited_allowlist",
  "unsupported_fail_closed",
]);
const COMMAND_SETS = Object.freeze(["readonly", "install_probe_design", "test_probe_design", "install_probe", "test_probe"]);
const EGRESS_DECISIONS = Object.freeze(["allowed", "denied", "observed"]);
const HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const DESIGN_ONLY_COMMAND_SETS = Object.freeze(new Set(["install_probe_design", "test_probe_design"]));

const EGRESS_HONESTY_NOTE = [
  "Egress limitation: Scout infers registry hostnames from planned argv and records egress log entries before each command.",
  "Docker sandboxes use bridge networking; Scout does not enforce packet-level egress filtering or observe runtime traffic.",
  "Commands whose inferred registry host is outside the approved list are blocked pre-execution.",
].join(" ");

export function validateNetworkExpansionContract(contract) {
  assertObject(contract, "NetworkExpansionContract");
  [
    "contract_id",
    "candidate_id",
    "repo",
    "issue",
    "network_policy",
    "command_set",
    "lifecycle_policy",
    "artifact_retention",
  ].forEach((field) => assertString(contract[field], `NetworkExpansionContract.${field}`));
  assertEnum(contract.network_policy, NETWORK_POLICIES, "NetworkExpansionContract.network_policy");
  assertEnum(contract.command_set, COMMAND_SETS, "NetworkExpansionContract.command_set");
  assertEnum(contract.lifecycle_policy, LIFECYCLE_POLICIES, "NetworkExpansionContract.lifecycle_policy");
  assertArray(contract.registry_hosts, "NetworkExpansionContract.registry_hosts");
  if (contract.registry_hosts.length === 0) {
    throw new Error("NetworkExpansionContract.registry_hosts must not be empty");
  }
  contract.registry_hosts.forEach((host, index) => validateRegistryHost(host, `NetworkExpansionContract.registry_hosts[${index}]`));
  assertFiniteInteger(contract.timeout_seconds, "NetworkExpansionContract.timeout_seconds", { min: 1 });
  assertString(contract.approval_phrase, "NetworkExpansionContract.approval_phrase");
  const requiredPhraseParts = [
    contract.candidate_id,
    contract.repo,
    contract.issue,
    contract.network_policy,
    contract.command_set,
    contract.lifecycle_policy,
    String(contract.timeout_seconds),
    contract.artifact_retention,
    ...contract.registry_hosts,
  ];
  for (const part of requiredPhraseParts) {
    if (!contract.approval_phrase.includes(part)) {
      throw new Error(`NetworkExpansionContract.approval_phrase must include ${part}`);
    }
  }
  return {
    ...contract,
    registry_hosts: [...new Set(contract.registry_hosts.map((host) => host.toLowerCase()))],
  };
}

export function isDesignOnlyCommandSet(commandSet) {
  return DESIGN_ONLY_COMMAND_SETS.has(commandSet);
}

export function renderNetworkApprovalText(contract) {
  const validated = validateNetworkExpansionContract(contract);
  const designOnly = isDesignOnlyCommandSet(validated.command_set);
  return [
    designOnly
      ? "Scout R2D network expansion dry-run plan. This approval text is not executable in the CLI."
      : "Scout R2D network expansion approval for executable `scout probe`.",
    "",
    "Exact approval phrase:",
    validated.approval_phrase,
    "",
    `Candidate: ${validated.candidate_id}`,
    `Repository: ${validated.repo}`,
    `Issue: ${validated.issue}`,
    `Network policy: ${validated.network_policy}`,
    `Registry hosts: ${validated.registry_hosts.join(", ")}`,
    `Command set: ${validated.command_set}`,
    `Lifecycle policy: ${validated.lifecycle_policy}`,
    `Timeout: ${validated.timeout_seconds}s`,
    `Artifact retention: ${validated.artifact_retention}`,
    "",
    designOnly
      ? "Use `scout plan install-dry-run` or `scout plan network-design` for planning only."
      : `Use \`scout probe --network registry_allowlist --command-set ${validated.command_set}\` with this contract and exact approval phrase.`,
    "",
    EGRESS_HONESTY_NOTE,
  ].join("\n");
}

export function renderNetworkDesignReportSection(contract) {
  const validated = validateNetworkExpansionContract(contract);
  const designOnly = isDesignOnlyCommandSet(validated.command_set);
  return [
    designOnly ? "## R2D Network Expansion Design" : "## R2D Network Expansion (executable probe)",
    "",
    designOnly
      ? "Status: dry-run planning only; no package install or test execution."
      : "Status: executable via `scout probe` when approval phrase and contract JSON match.",
    "",
    `- Candidate: ${validated.candidate_id}`,
    `- Repo: ${validated.repo}`,
    `- Issue: ${validated.issue}`,
    `- Network policy: ${validated.network_policy}`,
    `- Registry hosts: ${validated.registry_hosts.join(", ")}`,
    `- Command set: ${validated.command_set}`,
    `- Lifecycle policy: ${validated.lifecycle_policy}`,
    `- Timeout: ${validated.timeout_seconds}s`,
    `- Artifact retention: ${validated.artifact_retention}`,
    "",
    EGRESS_HONESTY_NOTE,
  ].join("\n");
}

export function createEgressLogRecord({ candidateId, networkPolicy, approvedHosts, observedHost, decision, commandId, reason }) {
  return validateEgressLogRecord({
    event_id: `egress-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    candidate_id: candidateId,
    network_policy: networkPolicy,
    approved_hosts: approvedHosts,
    observed_host: observedHost,
    decision,
    command_id: commandId,
    reason,
  });
}

export function evaluateEgressHost(observedHost, approvedHosts) {
  const normalized = String(observedHost ?? "").toLowerCase();
  const approved = new Set((approvedHosts ?? []).map((host) => String(host).toLowerCase()));
  if (!normalized) {
    return { decision: "denied", reason: "Missing observed host." };
  }
  if (approved.has(normalized)) {
    return { decision: "allowed", reason: "Host matched approved registry allowlist." };
  }
  return { decision: "denied", reason: `Host ${normalized} is outside approved registry allowlist.` };
}

export function validateEgressLogRecord(record) {
  assertObject(record, "EgressLogRecord");
  [
    "event_id",
    "timestamp",
    "candidate_id",
    "network_policy",
    "observed_host",
    "decision",
    "command_id",
    "reason",
  ].forEach((field) => assertString(record[field], `EgressLogRecord.${field}`));
  assertEnum(record.network_policy, NETWORK_POLICIES, "EgressLogRecord.network_policy");
  assertEnum(record.decision, EGRESS_DECISIONS, "EgressLogRecord.decision");
  validateRegistryHost(record.observed_host, "EgressLogRecord.observed_host");
  assertArray(record.approved_hosts, "EgressLogRecord.approved_hosts");
  if (record.approved_hosts.length === 0) {
    throw new Error("EgressLogRecord.approved_hosts must not be empty");
  }
  record.approved_hosts.forEach((host, index) => validateRegistryHost(host, `EgressLogRecord.approved_hosts[${index}]`));
  return {
    ...record,
    observed_host: record.observed_host.toLowerCase(),
    approved_hosts: [...new Set(record.approved_hosts.map((host) => host.toLowerCase()))],
  };
}

function validateRegistryHost(host, name) {
  assertString(host, name);
  if (host.includes("://") || host.includes("/") || host.includes(":")) {
    throw new Error(`${name} must be a hostname, not a URL or host:port`);
  }
  if (host.includes("*")) {
    throw new Error(`${name} must not contain wildcards`);
  }
  if (!HOST_PATTERN.test(host)) {
    throw new Error(`${name} must be an explicit DNS hostname`);
  }
  return host;
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
